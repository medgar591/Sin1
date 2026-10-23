// The inbox: turns incidents and world news into decisions for the player,
// and applies the consequences of the option chosen.
//
// Incident data conventions (what npc.ts should put in Incident.data; every
// key is optional and has a fallback):
//   raiseDemand       personIds [asker]; data.pct (fraction, e.g. 0.15)
//   promotionDemand   personIds [asker]; OR data.vacantUnitId = an empty seat
//   feud              personIds [a, b]
//   scheme            personIds [schemer, target]
//   leak/embezzlement/scandal  personIds [culprit]
//     (scandal/leak with data.source === 'fixer' is fixer blowback instead)
//   breakthrough      personIds [person]
//   resignationThreat personIds [person]
//   poachOffer        personIds [person]; data.offer (yearly zuzu)
//   complaint         personIds [complainant, manager]
//   cliqueFormed      personIds [leader]; data.cliqueId
//   managerFiring     personIds [manager, fired]; the fired person is already
//                     off the books (status 'fired'); incident.unitId is the unit
import type {
  ActionResult,
  GameState,
  Incident,
  InboxItem,
  InboxOption,
  Industry,
  Person,
  PersonId,
  RelTag,
  Role,
  Secret,
  UnitId,
} from './types';
import {
  addLifeEvent,
  addLog,
  adjustLoyalty,
  adjustOpinion,
  chainOfCommand,
  clamp,
  formatZuzu,
  fullName,
  isLead,
  monthLabel,
  newId,
  peopleUnder,
  person,
  placeAsMember,
  playerPerson,
  pronoun,
  removeFromCompany,
  setLead,
  unit,
} from './org';
import { chance, pick, randInt, random } from './rng';
import { createPerson } from './generate';

// ---------------------------------------------------------------- tuning

/** At most this many inbox items are created from incidents each month. */
export const MAX_NEW_ITEMS = 6;
/** One person can be the main subject of at most this many new items a month. */
const MAX_ITEMS_PER_SUBJECT = 1;
/** Items stay actionable through the turn of (created month + this). */
export const EXPIRY_MONTHS = 1;
const SEAT_EXPIRY_MONTHS = 2;
/** Months a breakthrough or scandal subject can be handled without penalty. */
const ATTENTION_MONTHS = 3;

const KIND_PRIORITY: Record<string, number> = {
  scandal: 8,
  embezzlement: 8,
  leak: 7,
  resignationThreat: 7,
  scheme: 6,
  managerFiring: 6,
  poachOffer: 6,
  fixerFallout: 9,
  seatVacancy: 8,
  breakthrough: 5,
  feud: 5,
  promotionDemand: 5,
  cliqueFormed: 4,
  complaint: 4,
  raiseDemand: 3,
};

const ROLE_RANK: Record<Role, number> = {
  ceo: 7,
  chair: 6,
  director: 6,
  officer: 5,
  divisionHead: 4,
  subdivisionHead: 3,
  teamLead: 2,
  subteamLead: 1.5,
  worker: 0,
};

/** Yearly salary floors/ceilings by role, used when someone is promoted. */
const SALARY_BAND: Record<Role, [number, number]> = {
  ceo: [0, 0],
  chair: [0, 0],
  director: [0, 0],
  officer: [400_000, 700_000],
  divisionHead: [300_000, 500_000],
  subdivisionHead: [160_000, 260_000],
  teamLead: [95_000, 150_000],
  subteamLead: [80_000, 120_000],
  worker: [40_000, 90_000],
};

const MARKET_MIN = 0.7;
const MARKET_MAX = 1.4;
/** Share of the gap to 1.0 the market closes each month. */
const MARKET_REVERSION = 0.12;
const RANDOM_NEWS_CHANCE = 0.45;
const BREAKTHROUGH_BONUS = 0.15; // of yearly salary, paid by the company
const TALENT_RECRUIT_COST = 250_000;

// ---------------------------------------------------------------- small helpers

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (f: number): string => `${Math.round(f * 100)}%`;
const ok = (message: string): ActionResult => ({ ok: true, message });
const no = (message: string): ActionResult => ({ ok: false, message });

function live(state: GameState, id: PersonId | undefined): Person | null {
  const p = id ? state.people[id] : undefined;
  return p && p.status === 'active' ? p : null;
}

const hasUnit = (state: GameState, id: unknown): id is UnitId => typeof id === 'string' && !!state.units[id];
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && isFinite(v) ? v : fallback);

function titleOf(p: Person): string {
  return p.title || p.role;
}

/** Friends, lovers, mentors and clique-mates feel what happens to someone. */
function ripple(state: GameState, subjectId: PersonId, delta: number): void {
  const subject = person(state, subjectId);
  const ceoId = state.player.personId;
  const tags: (RelTag | null)[] = ['friend', 'lover', 'mentor', 'protege'];
  for (const a of Object.values(state.people)) {
    if (a.status !== 'active' || a.id === subjectId || a.id === ceoId) continue;
    // tag on relations[x][y] labels y from x's view: a is a friend/protege/mentor
    // of the subject if either side's tag says so (a protector is the subject's 'mentor').
    const rel = state.relations[a.id]?.[subjectId];
    const back = state.relations[subjectId]?.[a.id];
    const close = (rel && rel.opinion >= 25 && tags.includes(rel.tag)) || (back && back.opinion >= 25 && tags.includes(back.tag));
    if (close) adjustLoyalty(state, a.id, Math.round(delta * 0.4));
    else if (subject.cliqueId && a.cliqueId === subject.cliqueId) adjustLoyalty(state, a.id, Math.round(delta * 0.25));
  }
}

/** The player's own Person, for opinion changes toward the CEO. */
function opinionOfCeo(state: GameState, id: PersonId, delta: number): void {
  if (id !== state.player.personId) adjustOpinion(state, id, state.player.personId, delta);
}

function giveRaise(_state: GameState, p: Person, fraction: number): number {
  const before = p.salary;
  p.salary = Math.round((p.salary * (1 + fraction)) / 100) * 100;
  return p.salary - before;
}

function dismiss(state: GameState, p: Person, status: 'fired' | 'arrested' | 'quit' | 'defected', fate: string): void {
  removeFromCompany(state, p.id, status, fate);
}

function demoteToMember(state: GameState, p: Person): void {
  if (p.unitId === null) return;
  const u = unit(state, p.unitId);
  if (u.leadId !== p.id) return;
  u.leadId = null;
  u.memberIds.push(p.id);
  p.role = 'worker';
}

/** Moves a non-lead into another team, preferring the same division. */
function moveToOtherTeam(state: GameState, p: Person): UnitId | null {
  if (p.unitId === null || isLead(state, p)) return null;
  const here = unit(state, p.unitId);
  const teams = Object.values(state.units).filter(
    (u) => (u.kind === 'team' || u.kind === 'subteam') && u.id !== here.id,
  );
  const sameDiv = teams.filter((u) => u.divisionId !== null && u.divisionId === here.divisionId);
  const pool = sameDiv.length ? sameDiv : teams.filter((u) => u.divisionId !== null);
  if (!pool.length) return null;
  const dest = pick(state, pool);
  placeAsMember(state, p.id, dest.id);
  return dest.id;
}

function addSecretToPlayer(state: GameState, description: string, severity: 1 | 2 | 3, involved: PersonId[]): void {
  const secret: Secret = {
    id: newId(state, 's'),
    kind: 'coverUp',
    description,
    severity,
    revealed: false,
    involvedIds: involved,
  };
  playerPerson(state).secrets.push(secret);
}

function revealSecrets(p: Person, kinds: Secret['kind'][]): Secret[] {
  const found = p.secrets.filter((s) => kinds.includes(s.kind) && !s.revealed);
  for (const s of found) s.revealed = true;
  return found;
}

function raiseIncident(state: GameState, inc: Incident): void {
  state.incidents.push(inc);
}

// ---------------------------------------------------------------- item drafts

interface Draft {
  kind: string;
  title: string;
  body: string;
  subjectIds: PersonId[];
  unitId: UnitId | null;
  options: InboxOption[];
  data?: Record<string, unknown>;
  expiryMonths?: number;
}

type Builder = (state: GameState, inc: Incident) => Draft | null;

const builders: Record<string, Builder> = {
  raiseDemand(state, inc) {
    const p = live(state, inc.personIds[0]);
    if (!p) return null;
    const ask = clamp(num(inc.data.pct, 0.15), 0.05, 0.4);
    const newSalary = Math.round(p.salary * (1 + ask));
    const case_ = p.performance >= 65 ? 'Recent performance supports the case.' : p.performance < 40 ? 'Performance does not support it.' : 'The case is average.';
    return {
      kind: 'raiseDemand',
      title: `${fullName(p)} wants a raise`,
      body: `${fullName(p)} (${titleOf(p)}) is asking for ${pct(ask)} more, ${formatZuzu(p.salary)} to ${formatZuzu(newSalary)}. ${case_}`,
      subjectIds: [p.id],
      unitId: p.unitId,
      data: { ask },
      options: [
        { id: 'refuse', label: 'Refuse', hint: 'Costs loyalty; may prompt a resignation threat' },
        { id: 'counter', label: `Counter at ${pct(ask / 2)}`, hint: 'Half now, a little goodwill' },
        { id: 'grant', label: `Grant ${pct(ask)}`, hint: `+${formatZuzu(newSalary - p.salary)}/yr, loyal and happy` },
        { id: 'promise', label: 'Promise a raise next quarter', hint: 'Tracked promise, due in 3 months' },
      ],
    };
  },

  promotionDemand(state, inc) {
    if (hasUnit(state, inc.data.vacantUnitId)) return buildSeat(state, inc, inc.data.vacantUnitId);
    const p = live(state, inc.personIds[0]);
    if (!p) return null;
    return {
      kind: 'promotionDemand',
      title: `${fullName(p)} wants a promotion`,
      body: `${fullName(p)} (${titleOf(p)}) believes ${pronoun(p, 'subject')} ${p.pronouns === 'they' ? 'are' : 'is'} ready for more and wants to hear a timetable. Ambition ${p.ambition}, performance ${p.performance}.`,
      subjectIds: [p.id],
      unitId: p.unitId,
      options: [
        { id: 'decline', label: 'Decline', hint: 'Satisfaction and loyalty drop' },
        { id: 'reassign', label: 'Move to a new team', hint: 'A fresh start elsewhere in the company' },
        { id: 'promise', label: 'Promise a promotion in 6 months', hint: 'Tracked promise; breaking it costs you' },
      ],
    };
  },

  feud(state, inc) {
    const a = live(state, inc.personIds[0]);
    const b = live(state, inc.personIds[1]);
    if (!a || !b) return null;
    const canMove = !isLead(state, a) || !isLead(state, b);
    const options: InboxOption[] = [
      { id: 'burn', label: 'Let it burn', hint: 'Morale in their unit suffers' },
      { id: 'sideA', label: `Side with ${fullName(a)}`, hint: `${fullName(b)} will remember` },
      { id: 'sideB', label: `Side with ${fullName(b)}`, hint: `${fullName(a)} will remember` },
      canMove
        ? { id: 'separate', label: 'Separate them', hint: 'Reassign one to another team' }
        : { id: 'mediate', label: 'Order them to settle it', hint: 'Both leads; tempers cool a little' },
    ];
    return {
      kind: 'feud',
      title: `${fullName(a)} and ${fullName(b)} are at war`,
      body: `${fullName(a)} (${titleOf(a)}) and ${fullName(b)} (${titleOf(b)}) have stopped cooperating. Their unit is feeling it.`,
      subjectIds: [a.id, b.id],
      unitId: inc.unitId ?? a.unitId,
      options,
    };
  },

  scheme(state, inc) {
    const s = live(state, inc.personIds[0]);
    const t = live(state, inc.personIds[1]);
    if (!s || !t) return null;
    return {
      kind: 'scheme',
      title: `${fullName(s)} is moving against ${fullName(t)}`,
      body: `Word reaches you that ${fullName(s)} (${titleOf(s)}) is working to undermine ${fullName(t)} (${titleOf(t)}). Ambition ${s.ambition}.`,
      subjectIds: [s.id, t.id],
      unitId: inc.unitId ?? t.unitId,
      options: [
        { id: 'ignore', label: 'Ignore it', hint: 'Politics. Let them sort it out' },
        { id: 'warn', label: `Quietly warn ${fullName(t)}`, hint: `${fullName(t)} grows loyal; ${fullName(s)} may find out` },
        { id: 'investigate', label: 'Have Security watch', hint: 'Costs 1 attention; may expose secrets', attention: 1 },
        { id: 'confront', label: `Confront ${fullName(s)}`, hint: 'Costs 1 attention; depends on their loyalty', attention: 1 },
      ],
    };
  },

  leak: (state, inc) => buildMisconduct(state, inc, 'leak'),
  embezzlement: (state, inc) => buildMisconduct(state, inc, 'embezzlement'),
  scandal(state, inc) {
    if (inc.data.source === 'fixer') return buildFixerFallout(state, inc);
    return buildMisconduct(state, inc, 'scandal');
  },

  breakthrough(state, inc) {
    const p = live(state, inc.personIds[0]);
    if (!p) return null;
    const lead = isLead(state, p);
    const options: InboxOption[] = [
      { id: 'note', label: 'Note it', hint: 'A word of thanks' },
      { id: 'reward', label: 'Reward them', hint: `Bonus of ${formatZuzu(p.salary * BREAKTHROUGH_BONUS)} and a 10% raise` },
    ];
    if (!lead) {
      options.push({ id: 'promote', label: 'Promote them to lead the team', hint: 'Displaces the sitting lead' });
      const better = Object.values(state.units).some((u) => (u.kind === 'team' || u.kind === 'subteam') && u.id !== p.unitId && u.divisionId !== null);
      if (better) options.push({ id: 'move', label: 'Move them to the top team', hint: 'Better unit, bigger stage' });
    } else {
      options.push({ id: 'options', label: 'Grant stock options', hint: 'Ties them to the company' });
    }
    return {
      kind: 'breakthrough',
      title: `${fullName(p)} has delivered`,
      body: `${fullName(p)} (${titleOf(p)}) pulled off something the company has been unable to for years. ${cap(pronoun(p, 'subject'))} can be dealt with directly for a few months.`,
      subjectIds: [p.id],
      unitId: p.unitId,
      options,
    };
  },

  resignationThreat(state, inc) {
    const p = live(state, inc.personIds[0]);
    if (!p) return null;
    return {
      kind: 'resignationThreat',
      title: `${fullName(p)} threatens to quit`,
      body: `${fullName(p)} (${titleOf(p)}) has put it plainly: change something or ${pronoun(p, 'subject')} leave${p.pronouns === 'they' ? '' : 's'}. Loyalty ${p.loyalty}, satisfaction ${p.satisfaction}.`,
      subjectIds: [p.id],
      unitId: p.unitId,
      options: [
        { id: 'letGo', label: 'Let them go', hint: 'They leave the company' },
        { id: 'counter', label: 'Counter-offer: 12% raise', hint: 'Usually works on the greedy' },
        { id: 'appeal', label: 'Appeal to their loyalty', hint: 'Costs 1 attention; works on the loyal', attention: 1 },
      ],
    };
  },

  poachOffer(state, inc) {
    const p = live(state, inc.personIds[0]);
    if (!p) return null;
    const offer = num(inc.data.offer, Math.round(p.salary * 1.25));
    return {
      kind: 'poachOffer',
      title: `A rival is courting ${fullName(p)}`,
      body: `An outside corp has offered ${fullName(p)} (${titleOf(p)}) ${formatZuzu(offer)} a year, against ${formatZuzu(p.salary)} now.`,
      subjectIds: [p.id],
      unitId: p.unitId,
      data: { offer },
      options: [
        { id: 'letGo', label: 'Let them go', hint: 'They take the offer' },
        { id: 'counter', label: `Match ${formatZuzu(offer)}`, hint: 'Keeps them; others may notice' },
        { id: 'appeal', label: 'Appeal to their loyalty', hint: 'Costs 1 attention; no money', attention: 1 },
      ],
    };
  },

  complaint(state, inc) {
    const c = live(state, inc.personIds[0]);
    const m = live(state, inc.personIds[1]);
    if (!c || !m) return null;
    return {
      kind: 'complaint',
      title: `${fullName(c)} files a complaint`,
      body: `${fullName(c)} (${titleOf(c)}) accuses ${fullName(m)} (${titleOf(m)}) of mistreating ${pronoun(c, 'object')} and the team.`,
      subjectIds: [c.id, m.id],
      unitId: inc.unitId ?? c.unitId,
      options: [
        { id: 'file', label: 'File it', hint: 'Nothing happens; the complainant notices' },
        { id: 'backComplainant', label: `Back ${fullName(c)}`, hint: `${fullName(m)} is censured` },
        { id: 'backManager', label: `Back ${fullName(m)}`, hint: `${fullName(c)} is told to get on with it` },
        { id: 'investigate', label: 'Investigate fairly', hint: 'Costs 1 attention; outcome depends on the facts', attention: 1 },
      ],
    };
  },

  cliqueFormed(state, inc) {
    const leader = live(state, inc.personIds[0]);
    if (!leader) return null;
    const cliqueId = typeof inc.data.cliqueId === 'string' ? inc.data.cliqueId : leader.cliqueId;
    const clique = cliqueId ? state.cliques[cliqueId] : undefined;
    if (!clique) return null;
    return {
      kind: 'cliqueFormed',
      title: `A faction forms around ${fullName(leader)}`,
      body: `${clique.name}: ${clique.memberIds.length} people led by ${fullName(leader)} (${titleOf(leader)}). Agenda: ${clique.agenda}`,
      subjectIds: [leader.id],
      unitId: leader.unitId,
      data: { cliqueId: clique.id },
      options: [
        { id: 'ignore', label: 'Ignore it', hint: 'They may grow' },
        { id: 'coopt', label: `Co-opt ${fullName(leader)}`, hint: 'A raise and a seat at the table' },
        { id: 'breakUp', label: 'Break it up', hint: 'Costs 1 attention; the leader resents it', attention: 1 },
      ],
    };
  },

  managerFiring(state, inc) {
    const m = live(state, inc.personIds[0]);
    const f = inc.personIds[1] ? state.people[inc.personIds[1]] : undefined;
    if (!m || !f) return null;
    return {
      kind: 'managerFiring',
      title: `${fullName(m)} fired ${fullName(f)}`,
      body: `${fullName(m)} (${titleOf(m)}) has dismissed ${fullName(f)}. ${cap(pronoun(f, 'subject'))} ${f.pronouns === 'they' ? 'have' : 'has'} appealed to you.`,
      subjectIds: [m.id, f.id],
      unitId: inc.unitId ?? m.unitId,
      options: [
        { id: 'stand', label: 'Let it stand', hint: `Backs ${fullName(m)}` },
        { id: 'overrule', label: 'Overrule and reinstate', hint: `${fullName(m)} will resent being overruled` },
      ],
    };
  },
};

function buildMisconduct(state: GameState, inc: Incident, kind: 'leak' | 'embezzlement' | 'scandal'): Draft | null {
  const p = live(state, inc.personIds[0]);
  if (!p) return null;
  const copy = {
    leak: { title: `${fullName(p)} leaked company information`, body: 'Security traced a leak of internal material to', legal: 'Hand it to Legal', hint: 'Dismissed quietly under NDA' },
    embezzlement: { title: `${fullName(p)} is skimming funds`, body: 'The books show money going missing, and the trail leads to', legal: 'Hand it to Legal', hint: 'Prosecution; arrested' },
    scandal: { title: `Scandal around ${fullName(p)}`, body: 'The press and the floor are talking about', legal: 'Hand it to Legal', hint: 'Containment and discipline' },
  }[kind];
  const detail = typeof inc.data.detail === 'string' ? ` ${inc.data.detail}` : '';
  return {
    kind,
    title: copy.title,
    body: `${copy.body} ${fullName(p)} (${titleOf(p)}).${detail}`,
    subjectIds: [p.id],
    unitId: p.unitId,
    options: [
      { id: 'legal', label: copy.legal, hint: copy.hint },
      { id: 'fire', label: 'Fire them', hint: 'Immediate; ripples through their friends' },
      { id: 'discipline', label: 'Discipline them', hint: 'Keeps them, humbled' },
      { id: 'coverUp', label: 'Cover it up', hint: 'Costs 1 attention; they owe you, but it becomes a secret of yours', attention: 1 },
    ],
  };
}

function buildFixerFallout(_state: GameState, inc: Incident): Draft {
  const what = typeof inc.data.what === 'string' ? inc.data.what : 'A fixer job went wrong and the trail leads to the company.';
  return {
    kind: 'fixerFallout',
    title: 'Fixer job traced to us',
    body: what,
    subjectIds: [],
    unitId: inc.unitId,
    options: [
      { id: 'blowOver', label: 'Let it blow over', hint: 'Cost already taken' },
      { id: 'deny', label: 'Legal issues a denial', hint: `${formatZuzu(100_000)}; steadies your reputation` },
      { id: 'hush', label: 'Pay people off', hint: `${formatZuzu(500_000)}; quiets it and calms the board` },
    ],
  };
}

// --- vacant seat

interface Candidate {
  id: PersonId;
  score: number;
}

function seatCandidates(state: GameState, unitId: UnitId): Candidate[] {
  const u = unit(state, unitId);
  const pool = new Set<PersonId>(peopleUnder(state, unitId));
  // leads of sibling units are natural candidates for a lead seat
  if (u.parentId) for (const sib of unit(state, u.parentId).childIds) {
    const l = unit(state, sib).leadId;
    if (l) pool.add(l);
  }
  const ceo = state.player.personId;
  const out: Candidate[] = [];
  for (const id of pool) {
    const p = live(state, id);
    if (!p || p.id === ceo || p.role === 'officer') continue;
    const sen = ROLE_RANK[p.role] * 3;
    out.push({ id, score: p.skills.work * 0.35 + p.skills.management * 0.4 + p.performance * 0.2 + sen });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 3);
}

function backerOf(state: GameState, id: PersonId): string | null {
  const p = person(state, id);
  const clique = p.cliqueId ? state.cliques[p.cliqueId] : undefined;
  if (clique && clique.leaderId !== id) {
    const l = live(state, clique.leaderId);
    if (l) return fullName(l);
  }
  let best: { id: PersonId; op: number } | null = null;
  for (const b of chainOfCommand(state, id)) {
    const op = state.relations[b]?.[id]?.opinion ?? 0;
    if (op >= 30 && (!best || op > best.op)) best = { id: b, op };
  }
  return best ? fullName(person(state, best.id)) : null;
}

function buildSeat(state: GameState, _inc: Incident, unitId: UnitId): Draft | null {
  const u = unit(state, unitId);
  const cands = seatCandidates(state, unitId);
  if (!cands.length) return null;
  const options: InboxOption[] = [{ id: 'leave', label: 'Leave it empty for now', hint: 'The seat stays vacant; someone acts up' }];
  const lines: string[] = [];
  for (const c of cands) {
    const p = person(state, c.id);
    const backer = backerOf(state, c.id);
    const pitch = `Work ${p.skills.work}, mgmt ${p.skills.management}${backer ? `, backed by ${backer}` : ''}`;
    options.push({ id: `seat:${c.id}`, label: `Seat ${fullName(p)}`, hint: pitch });
    lines.push(`${fullName(p)} (${titleOf(p)}): ${pitch}.`);
  }
  return {
    kind: 'seatVacancy',
    title: `${u.name} has no head`,
    body: `The lead seat of ${u.name} is empty. ${lines.join(' ')}`,
    subjectIds: cands.map((c) => c.id),
    unitId,
    data: { vacantUnitId: unitId },
    options,
    expiryMonths: SEAT_EXPIRY_MONTHS,
  };
}

// ---------------------------------------------------------------- generateEvents

function itemPriority(state: GameState, d: Draft): number {
  let seniority = 0;
  for (const id of d.subjectIds) {
    const p = state.people[id];
    if (p) seniority = Math.max(seniority, ROLE_RANK[p.role]);
  }
  return (KIND_PRIORITY[d.kind] ?? 3) + seniority;
}

function draftKey(d: Draft): string {
  return `${d.kind}:${d.subjectIds.slice().sort().join(',')}:${d.unitId ?? ''}`;
}

/** Consumes state.incidents and adds world news; creates inbox items. Clears incidents. */
export function generateEvents(state: GameState): void {
  runWorldNews(state);

  const drafts: Draft[] = [];
  const seen = new Set(state.inbox.filter((i) => i.resolution === null).map((i) => `${i.kind}:${i.subjectIds.slice().sort().join(',')}:${i.unitId ?? ''}`));
  for (const inc of state.incidents) {
    const build = builders[inc.kind];
    const d = build ? build(state, inc) : null;
    if (!d) continue;
    const key = draftKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    drafts.push(d);
  }

  // Highest priority first; stable on arrival order via index.
  const ranked = drafts
    .map((d, i) => ({ d, i, pr: itemPriority(state, d) }))
    .sort((a, b) => b.pr - a.pr || a.i - b.i);

  const perSubject = new Map<PersonId, number>();
  let made = 0;
  for (const { d } of ranked) {
    const main = d.subjectIds[0];
    const full = made >= MAX_NEW_ITEMS || (main !== undefined && (perSubject.get(main) ?? 0) >= MAX_ITEMS_PER_SUBJECT);
    if (full) {
      addLog(state, `Not escalated: ${d.title}.`, 1, d.subjectIds.slice(0, 2));
      continue;
    }
    if (main !== undefined) perSubject.set(main, (perSubject.get(main) ?? 0) + 1);
    createItem(state, d);
    made++;
  }
  state.incidents = [];
}

function createItem(state: GameState, d: Draft): InboxItem {
  const item: InboxItem = {
    id: newId(state, 'i'),
    month: state.month,
    kind: d.kind,
    title: d.title,
    body: d.body,
    subjectIds: d.subjectIds,
    unitId: d.unitId,
    options: d.options,
    resolution: null,
    expiresMonth: state.month + (d.expiryMonths ?? EXPIRY_MONTHS),
    data: d.data ?? {},
  };
  state.inbox.push(item);
  // Breakthrough and scandal subjects (often low-level) come to the CEO's attention.
  const main = d.subjectIds[0] ? state.people[d.subjectIds[0]] : undefined;
  if (main && (d.kind === 'breakthrough' || d.kind === 'scandal' || d.kind === 'embezzlement' || d.kind === 'leak')) {
    main.attentionUntil = state.month + ATTENTION_MONTHS;
    main.attentionReason = d.kind === 'breakthrough' ? 'Breakthrough' : d.kind === 'scandal' ? 'Scandal' : d.kind === 'leak' ? 'Leak' : 'Embezzlement inquiry';
  }
  return item;
}

// ---------------------------------------------------------------- world news

interface NewsBeat {
  headline: string;
  /** Market nudges by industry. */
  markets: Partial<Record<Industry, number>>;
}

/** Sinless timeline beats by month index (0 = Jan 2090). */
const TIMELINE: Record<number, NewsBeat> = {
  1: {
    headline: 'Feb 2090: Mammon, formerly Chicago, is quarantined and cut from the grid. Supply lines scramble; Logistics and Construction demand surges, Finance is jittery.',
    markets: { Logistics: 0.16, Construction: 0.12, Finance: -0.08, Food: 0.04 },
  },
  7: {
    headline: 'Aug 2090: The Shan-Effort field drops to 60%. Manon surges; Manastelliate and Pharma demand climbs and more awakened talent is on the market.',
    markets: { Manastelliate: 0.2, Pharma: 0.12 },
  },
};

const RANDOM_NEWS: Record<Industry, { up: string[]; down: string[] }> = {
  Food: { up: ['Ration contracts widen across the arcologies.'], down: ['A blight scare dents grocery demand.'] },
  Pharma: { up: ['A clinic network approves bulk orders.'], down: ['Regulators tighten on generics.'] },
  Security: { up: ['Corp-on-corp tension lifts contract bids.'], down: ['A major client brings security in-house.'] },
  Cyberware: { up: ['A new grid-linked implant standard drives upgrades.'], down: ['A recall hits the implant sector.'] },
  Media: { up: ['A viral series lifts ad spending.'], down: ['Advertisers pull back from the feeds.'] },
  Logistics: { up: ['Freight rates climb on rerouted traffic.'], down: ['Overcapacity pushes shipping rates down.'] },
  Finance: { up: ['Credit markets loosen.'], down: ['A liquidity scare grips the exchanges.'] },
  Construction: { up: ['Reconstruction tenders open in the east.'], down: ['Permits stall at the city offices.'] },
  'Grid Services': { up: ['Metatron upgrades drive demand for services.'], down: ['A grid-wide outage shakes confidence.'] },
  Manastelliate: { up: ['Awakened demand outpaces supply.'], down: ['A thaumaturgy audit chills investors.'] },
};

function nudgeMarket(state: GameState, industry: Industry, delta: number): void {
  for (const d of Object.values(state.divisions)) {
    if (d.industry === industry) d.market = clamp(d.market + delta, MARKET_MIN, MARKET_MAX);
  }
}

function runWorldNews(state: GameState): void {
  // Markets drift back toward normal first, so shocks fade over a few months.
  for (const d of Object.values(state.divisions)) {
    d.market = clamp(d.market + (1 - d.market) * MARKET_REVERSION, MARKET_MIN, MARKET_MAX);
  }

  const beat = TIMELINE[state.month];
  if (beat) {
    for (const [ind, delta] of Object.entries(beat.markets)) nudgeMarket(state, ind as Industry, delta);
    addLog(state, beat.headline, 2);
    if (state.month === 7) offerTalentWave(state);
    return;
  }

  if (!chance(state, RANDOM_NEWS_CHANCE)) return;
  const industries = [...new Set(Object.keys(state.divisions).sort().map((id) => state.divisions[id].industry))];
  if (!industries.length) return;
  const ind = pick(state, industries);
  const up = chance(state, 0.5);
  const delta = (randInt(state, 4, 10) / 100) * (up ? 1 : -1);
  nudgeMarket(state, ind, delta);
  addLog(state, `${monthLabel(state.month)}: ${pick(state, RANDOM_NEWS[ind][up ? 'up' : 'down'])} (${ind} demand ${up ? 'up' : 'down'}).`, 2);
}

/** Awakened talent appears when the field drops; the player may recruit one. */
function offerTalentWave(state: GameState): void {
  const target = Object.values(state.divisions).find((d) => d.industry === 'Manastelliate') ?? Object.values(state.divisions).find((d) => d.industry === 'Pharma');
  if (!target) return;
  const teams = Object.values(state.units).filter((u) => (u.kind === 'team' || u.kind === 'subteam') && u.divisionId === target.unitId);
  if (!teams.length) return;
  createItem(state, {
    kind: 'talentWave',
    title: 'Awakened talent on the market',
    body: `With the field thinning, newly awakened specialists are looking for sponsors. A recruiter can place one in ${unit(state, target.unitId).name} for ${formatZuzu(TALENT_RECRUIT_COST)}.`,
    subjectIds: [],
    unitId: target.unitId,
    data: { divisionId: target.unitId },
    options: [
      { id: 'pass', label: 'Pass', hint: 'Competitors will take them' },
      { id: 'recruit', label: `Recruit one (${formatZuzu(TALENT_RECRUIT_COST)})`, hint: 'A strong hire with attention for a while' },
    ],
    expiryMonths: 2,
  });
}

// ---------------------------------------------------------------- handlers

type Handler = (state: GameState, item: InboxItem, optionId: string) => ActionResult;

function gone(): ActionResult {
  return ok('The matter is moot; the person is no longer with the company.');
}

const handlers: Record<string, Handler> = {
  raiseDemand(state, item, opt) {
    const p = live(state, item.subjectIds[0]);
    if (!p) return gone();
    const ask = num(item.data.ask, 0.15);
    const name = fullName(p);
    if (opt === 'grant') {
      giveRaise(state, p, ask);
      p.satisfaction = clamp(p.satisfaction + 12);
      adjustLoyalty(state, p.id, 4);
      addLifeEvent(state, p.id, 'raise', `Granted a ${pct(ask)} raise.`, 4, true);
      return ok(`${name} gets the full ${pct(ask)}. ${cap(pronoun(p, 'subject'))} will not forget it.`);
    }
    if (opt === 'counter') {
      giveRaise(state, p, ask / 2);
      p.satisfaction = clamp(p.satisfaction + 3);
      addLifeEvent(state, p.id, 'raise', `Got a ${pct(ask / 2)} raise after asking for ${pct(ask)}.`, 2, true);
      return ok(`${name} takes ${pct(ask / 2)}, with some grumbling.`);
    }
    if (opt === 'promise') {
      state.promises.push({
        id: newId(state, 'pr'),
        personId: p.id,
        kind: 'raise',
        madeMonth: state.month,
        dueMonth: state.month + 3,
        detail: `A ${pct(ask)} raise next quarter.`,
        state: 'open',
      });
      p.satisfaction = clamp(p.satisfaction + 4);
      adjustLoyalty(state, p.id, 2);
      return ok(`You promise ${name} a raise next quarter. It is on the books.`);
    }
    // refuse
    p.satisfaction = clamp(p.satisfaction - 8);
    adjustLoyalty(state, p.id, -5);
    addLifeEvent(state, p.id, 'raiseRefused', 'Had a raise request refused.', -2, true);
    if (chance(state, 0.15 + p.greed / 300 + (p.loyalty < 40 ? 0.15 : 0))) {
      raiseIncident(state, { kind: 'resignationThreat', personIds: [p.id], unitId: p.unitId, data: { reason: 'raise' } });
      return ok(`${name} is refused and takes it badly. Expect more from ${pronoun(p, 'object')}.`);
    }
    return ok(`${name} is refused and says nothing.`);
  },

  promotionDemand(state, item, opt) {
    const p = live(state, item.subjectIds[0]);
    if (!p) return gone();
    const name = fullName(p);
    if (opt === 'promise') {
      state.promises.push({
        id: newId(state, 'pr'),
        personId: p.id,
        kind: 'promotion',
        madeMonth: state.month,
        dueMonth: state.month + 6,
        detail: 'A promotion within six months.',
        state: 'open',
      });
      adjustLoyalty(state, p.id, 5);
      p.satisfaction = clamp(p.satisfaction + 6);
      return ok(`You promise ${name} a promotion within six months.`);
    }
    if (opt === 'reassign') {
      const dest = moveToOtherTeam(state, p);
      if (dest) {
        p.satisfaction = clamp(p.satisfaction + 4);
        addLifeEvent(state, p.id, 'reassigned', `Moved to ${unit(state, dest).name} after asking for a promotion.`, 1, true);
        return ok(`${name} moves to ${unit(state, dest).name}.`);
      }
      p.satisfaction = clamp(p.satisfaction - 3);
      return ok(`There is nowhere to move ${name}; ${pronoun(p, 'subject')} stays put.`);
    }
    p.satisfaction = clamp(p.satisfaction - 8);
    adjustLoyalty(state, p.id, -6);
    addLifeEvent(state, p.id, 'passedOver', 'Told there would be no promotion.', -3, true);
    return ok(`${name} is turned down and does not hide it.`);
  },

  seatVacancy(state, item, opt) {
    const unitId = item.data.vacantUnitId as UnitId;
    const u = state.units[unitId];
    if (!u) return ok('The seat no longer exists.');
    if (opt === 'leave') return ok(`${u.name} stays without a head for now.`);
    const chosenId = opt.replace('seat:', '');
    const chosen = live(state, chosenId);
    if (!chosen) return no('That candidate has left the company.');
    const old = u.leadId ? live(state, u.leadId) : null;
    const oldSeat = chosen.unitId && isLead(state, chosen) ? unit(state, chosen.unitId) : null;
    if (old && old.id !== chosen.id) {
      // the seat was filled meanwhile; the sitting lead steps down into the unit
      u.leadId = null;
      u.memberIds.push(old.id);
      old.role = 'worker';
      old.unitId = u.id;
      old.satisfaction = clamp(old.satisfaction - 10);
      adjustLoyalty(state, old.id, -6);
      addLifeEvent(state, old.id, 'demoted', `Stepped down from leading ${u.name}.`, -4, true);
    }
    setLead(state, u.id, chosen.id);
    const [lo, hi] = SALARY_BAND[chosen.role];
    chosen.salary = Math.round(clamp(Math.max(chosen.salary * 1.15, lo), lo, Math.max(hi, chosen.salary)) / 100) * 100;
    chosen.title = `Head, ${u.name}`;
    chosen.satisfaction = clamp(chosen.satisfaction + 15);
    adjustLoyalty(state, chosen.id, 10);
    addLifeEvent(state, chosen.id, 'promoted', `Named to lead ${u.name}.`, 7, true);
    ripple(state, chosen.id, 6);
    for (const id of item.subjectIds) {
      const other = live(state, id);
      if (!other || other.id === chosen.id) continue;
      other.satisfaction = clamp(other.satisfaction - 5);
      adjustLoyalty(state, other.id, -3);
      if (other.ambition > 50) addLifeEvent(state, other.id, 'passedOver', `Passed over for ${u.name}.`, -3, true);
    }
    const tail = oldSeat ? ` ${oldSeat.name} loses its head.` : '';
    return ok(`${fullName(chosen)} now leads ${u.name}.${tail}`);
  },

  feud(state, item, opt) {
    const a = live(state, item.subjectIds[0]);
    const b = live(state, item.subjectIds[1]);
    if (!a || !b) return gone();
    const u = item.unitId ? state.units[item.unitId] : undefined;
    const side = (win: Person, lose: Person): ActionResult => {
      win.satisfaction = clamp(win.satisfaction + 6);
      adjustLoyalty(state, win.id, 6);
      lose.satisfaction = clamp(lose.satisfaction - 8);
      adjustLoyalty(state, lose.id, -8);
      adjustOpinion(state, lose.id, win.id, -10);
      opinionOfCeo(state, lose.id, -10);
      addLifeEvent(state, win.id, 'backed', `Backed by the CEO in a feud with ${fullName(lose)}.`, 3, true);
      addLifeEvent(state, lose.id, 'overruled', `Lost a feud with ${fullName(win)} when the CEO sided against ${pronoun(lose, 'object')}.`, -3, true);
      ripple(state, lose.id, -4);
      if (u) u.morale = clamp(u.morale + 1);
      return ok(`You side with ${fullName(win)}. ${fullName(lose)} is left bitter.`);
    };
    switch (opt) {
      case 'sideA': return side(a, b);
      case 'sideB': return side(b, a);
      case 'separate': {
        const mover = !isLead(state, b) ? b : a;
        const dest = moveToOtherTeam(state, mover);
        if (dest) {
          adjustOpinion(state, a.id, b.id, 5);
          adjustOpinion(state, b.id, a.id, 5);
          addLifeEvent(state, mover.id, 'reassigned', `Moved to ${unit(state, dest).name} to end a feud.`, -1, true);
          return ok(`${fullName(mover)} moves to ${unit(state, dest).name}. The fighting stops.`);
        }
        return ok('There is nowhere to move either of them; the feud continues.');
      }
      case 'mediate': {
        adjustOpinion(state, a.id, b.id, 12);
        adjustOpinion(state, b.id, a.id, 12);
        adjustLoyalty(state, a.id, -2);
        adjustLoyalty(state, b.id, -2);
        return ok(`You order ${fullName(a)} and ${fullName(b)} to settle it. They agree to a truce.`);
      }
      default: {
        adjustOpinion(state, a.id, b.id, -8);
        adjustOpinion(state, b.id, a.id, -8);
        if (u) u.morale = clamp(u.morale - 3);
        return ok(`The feud between ${fullName(a)} and ${fullName(b)} festers.`);
      }
    }
  },

  scheme(state, item, opt) {
    const s = live(state, item.subjectIds[0]);
    const t = live(state, item.subjectIds[1]);
    if (!s || !t) return gone();
    switch (opt) {
      case 'warn':
        adjustLoyalty(state, t.id, 6);
        adjustOpinion(state, t.id, s.id, -15);
        if (chance(state, 0.3 + s.skills.guile / 300)) {
          adjustOpinion(state, s.id, t.id, -10);
          return ok(`You warn ${fullName(t)}. ${fullName(s)} learns of it and the two are now open enemies.`);
        }
        return ok(`You warn ${fullName(t)} quietly. ${cap(pronoun(t, 'subject'))} ${t.pronouns === 'they' ? 'are' : 'is'} on guard.`);
      case 'investigate': {
        s.investigatedMonth = state.month;
        const found = s.secrets.filter((x) => !x.revealed).sort((x, y) => y.severity - x.severity)[0];
        if (found) {
          found.revealed = true;
          addLifeEvent(state, s.id, 'investigated', 'Investigated by Security over a scheme.', -2, true);
          return ok(`Security finds that ${fullName(s)} is hiding: ${found.description}`);
        }
        addLifeEvent(state, s.id, 'investigated', 'Investigated by Security over a scheme.', -1, true);
        return ok(`Security confirms the scheme against ${fullName(t)} but finds nothing else on ${fullName(s)}.`);
      }
      case 'confront':
        if (s.loyalty + (s.traits.includes('cautious') ? 15 : 0) >= 50) {
          adjustLoyalty(state, s.id, 3);
          s.ambition = clamp(s.ambition - 5);
          return ok(`${fullName(s)} backs down and drops it.`);
        }
        adjustLoyalty(state, s.id, -8);
        opinionOfCeo(state, s.id, -10);
        return ok(`${fullName(s)} denies everything and resents being accused. The scheme goes quiet, for now.`);
      default:
        adjustOpinion(state, s.id, t.id, -5);
        return ok(`You let ${fullName(s)} and ${fullName(t)} work it out.`);
    }
  },

  leak: (state, item, opt) => misconduct(state, item, opt, 'leak'),
  embezzlement: (state, item, opt) => misconduct(state, item, opt, 'embezzlement'),
  scandal: (state, item, opt) => misconduct(state, item, opt, 'scandal'),

  breakthrough(state, item, opt) {
    const p = live(state, item.subjectIds[0]);
    if (!p) return gone();
    const name = fullName(p);
    switch (opt) {
      case 'reward': {
        const bonus = Math.round(p.salary * BREAKTHROUGH_BONUS);
        state.company.cash -= bonus;
        giveRaise(state, p, 0.1);
        p.satisfaction = clamp(p.satisfaction + 15);
        adjustLoyalty(state, p.id, 8);
        addLifeEvent(state, p.id, 'rewarded', `Rewarded with a ${formatZuzu(bonus)} bonus and a raise for a breakthrough.`, 6, true);
        return ok(`${name} gets ${formatZuzu(bonus)} and a 10% raise.`);
      }
      case 'promote': {
        if (!p.unitId || isLead(state, p)) return no(`${name} already leads.`);
        const u = unit(state, p.unitId);
        const old = u.leadId ? live(state, u.leadId) : null;
        if (old) {
          demoteToMember(state, old);
          old.satisfaction = clamp(old.satisfaction - 10);
          adjustLoyalty(state, old.id, -6);
          addLifeEvent(state, old.id, 'demoted', `Replaced as head of ${u.name} by ${name}.`, -4, true);
        }
        setLead(state, u.id, p.id);
        const [lo] = SALARY_BAND[p.role];
        p.salary = Math.max(p.salary, lo);
        p.satisfaction = clamp(p.satisfaction + 18);
        adjustLoyalty(state, p.id, 10);
        addLifeEvent(state, p.id, 'promoted', `Promoted to lead ${u.name} after a breakthrough.`, 8, true);
        return ok(`${name} now leads ${u.name}${old ? `; ${fullName(old)} steps down` : ''}.`);
      }
      case 'move': {
        if (!p.unitId || isLead(state, p)) return no(`${name} already leads.`);
        const best = Object.values(state.units)
          .filter((u) => (u.kind === 'team' || u.kind === 'subteam') && u.id !== p.unitId && u.divisionId !== null)
          .sort((x, y) => y.output - x.output || x.id.localeCompare(y.id))[0];
        if (!best) return no('There is no better unit to move them to.');
        placeAsMember(state, p.id, best.id);
        p.satisfaction = clamp(p.satisfaction + 10);
        adjustLoyalty(state, p.id, 5);
        addLifeEvent(state, p.id, 'reassigned', `Moved to ${best.name} after a breakthrough.`, 5, true);
        return ok(`${name} moves to ${best.name}, the strongest team in the company.`);
      }
      case 'options':
        p.stockOptions += 2_000;
        p.satisfaction = clamp(p.satisfaction + 8);
        adjustLoyalty(state, p.id, 6);
        addLifeEvent(state, p.id, 'rewarded', 'Granted stock options for a breakthrough.', 5, true);
        return ok(`${name} is granted 2,000 options.`);
      default:
        p.satisfaction = clamp(p.satisfaction + 2);
        addLifeEvent(state, p.id, 'noted', 'The CEO noted a breakthrough.', 1, true);
        return ok(`You note ${name}'s work.`);
    }
  },

  resignationThreat(state, item, opt) {
    const p = live(state, item.subjectIds[0]);
    if (!p) return gone();
    const name = fullName(p);
    if (opt === 'counter') {
      giveRaise(state, p, 0.12);
      p.satisfaction = clamp(p.satisfaction + 15);
      adjustLoyalty(state, p.id, 4);
      addLifeEvent(state, p.id, 'raise', 'Persuaded to stay with a 12% raise.', 4, true);
      return ok(`${name} takes the money and stays.`);
    }
    if (opt === 'appeal') {
      if (random(state) * 100 < p.loyalty + (p.traits.includes('generous') ? 5 : 0)) {
        p.satisfaction = clamp(p.satisfaction + 10);
        adjustLoyalty(state, p.id, 6);
        addLifeEvent(state, p.id, 'retained', 'Talked into staying by the CEO.', 3, true);
        return ok(`You reach ${name}. ${cap(pronoun(p, 'subject'))} stay${p.pronouns === 'they' ? '' : 's'}.`);
      }
      dismiss(state, p, 'quit', 'Resigned over the CEO\'s head and left the company.');
      addLifeEvent(state, p.id, 'quit', 'Resigned despite the CEO\'s appeal.', -3, true);
      ripple(state, p.id, -3);
      return ok(`${name} listens and leaves anyway.`);
    }
    dismiss(state, p, 'quit', 'Resigned after the CEO let the threat stand.');
    addLifeEvent(state, p.id, 'quit', 'Resigned when the CEO let ${pronoun} go.'.replace('${pronoun}', pronoun(p, 'object')), -2, true);
    ripple(state, p.id, -3);
    return ok(`${name} resigns.`);
  },

  poachOffer(state, item, opt) {
    const p = live(state, item.subjectIds[0]);
    if (!p) return gone();
    const name = fullName(p);
    const offer = num(item.data.offer, p.salary * 1.25);
    if (opt === 'counter') {
      const raise = Math.max(0, offer - p.salary);
      p.salary = Math.round(offer / 100) * 100;
      p.satisfaction = clamp(p.satisfaction + 8);
      adjustLoyalty(state, p.id, 3);
      addLifeEvent(state, p.id, 'retained', `Matched a rival's offer, +${formatZuzu(raise)}/yr.`, 4, true);
      return ok(`You match the offer. ${name} stays at ${formatZuzu(p.salary)}.`);
    }
    if (opt === 'appeal') {
      if (random(state) * 100 < p.loyalty * 0.9 - p.greed * 0.2 + 15) {
        adjustLoyalty(state, p.id, 5);
        addLifeEvent(state, p.id, 'retained', 'Turned down a rival offer after speaking with the CEO.', 3, true);
        return ok(`${name} turns the rival down.`);
      }
      dismiss(state, p, 'defected', 'Joined a rival corporation.');
      addLifeEvent(state, p.id, 'defected', 'Left for a rival corporation despite the CEO\'s appeal.', 1, true);
      ripple(state, p.id, -3);
      return ok(`${name} thanks you and takes the rival's offer.`);
    }
    dismiss(state, p, 'defected', 'Joined a rival corporation.');
    addLifeEvent(state, p.id, 'defected', 'Left for a rival corporation.', 2, true);
    ripple(state, p.id, -3);
    return ok(`${name} leaves for the rival.`);
  },

  complaint(state, item, opt) {
    const c = live(state, item.subjectIds[0]);
    const m = live(state, item.subjectIds[1]);
    if (!c || !m) return gone();
    const u = item.unitId ? state.units[item.unitId] : undefined;
    const backC = (why: string): ActionResult => {
      c.satisfaction = clamp(c.satisfaction + 10);
      adjustLoyalty(state, c.id, 6);
      m.satisfaction = clamp(m.satisfaction - 8);
      adjustLoyalty(state, m.id, -6);
      adjustOpinion(state, m.id, c.id, -20);
      opinionOfCeo(state, m.id, -8);
      addLifeEvent(state, c.id, 'vindicated', `Complaint against ${fullName(m)} upheld.`, 4, true);
      addLifeEvent(state, m.id, 'censured', `Censured after a complaint from ${fullName(c)}.`, -3, true);
      if (u) u.morale = clamp(u.morale + 3);
      return ok(why);
    };
    const backM = (why: string): ActionResult => {
      m.satisfaction = clamp(m.satisfaction + 3);
      adjustLoyalty(state, m.id, 4);
      c.satisfaction = clamp(c.satisfaction - 10);
      adjustLoyalty(state, c.id, -5);
      adjustOpinion(state, c.id, m.id, -10);
      addLifeEvent(state, c.id, 'dismissed', 'Complaint brushed aside by the CEO.', -3, true);
      if (chance(state, 0.2)) raiseIncident(state, { kind: 'resignationThreat', personIds: [c.id], unitId: c.unitId, data: { reason: 'complaint' } });
      return ok(why);
    };
    switch (opt) {
      case 'backComplainant': return backC(`You back ${fullName(c)}. ${fullName(m)} is censured.`);
      case 'backManager': return backM(`You back ${fullName(m)}. ${fullName(c)} is told to get on with it.`);
      case 'investigate': {
        const atFault = 0.35 + (m.traits.includes('petty') || m.traits.includes('ruthless') ? 0.3 : 0) - (m.traits.includes('principled') ? 0.2 : 0);
        if (chance(state, atFault)) return backC(`The inquiry finds for ${fullName(c)}. ${fullName(m)} is reprimanded.`);
        return backM(`The inquiry finds no case against ${fullName(m)}.`);
      }
      default:
        c.satisfaction = clamp(c.satisfaction - 6);
        adjustLoyalty(state, c.id, -2);
        return ok(`The complaint is filed and nothing happens.`);
    }
  },

  cliqueFormed(state, item, opt) {
    const clique = state.cliques[item.data.cliqueId as string];
    const leader = live(state, item.subjectIds[0]);
    if (!clique || !leader) return ok('The faction has dissolved on its own.');
    switch (opt) {
      case 'breakUp': {
        for (const id of clique.memberIds) {
          const m = state.people[id];
          if (!m) continue;
          m.cliqueId = null;
          m.satisfaction = clamp(m.satisfaction - 3);
        }
        delete state.cliques[clique.id];
        adjustLoyalty(state, leader.id, -6);
        opinionOfCeo(state, leader.id, -10);
        addLifeEvent(state, leader.id, 'clique', `The CEO broke up ${clique.name}.`, -2, true);
        return ok(`${clique.name} is broken up. ${fullName(leader)} resents it.`);
      }
      case 'coopt': {
        giveRaise(state, leader, 0.08);
        adjustLoyalty(state, leader.id, 10);
        opinionOfCeo(state, leader.id, 10);
        for (const id of clique.memberIds) if (id !== leader.id && state.people[id]) adjustLoyalty(state, id, 3);
        clique.known = true;
        addLifeEvent(state, leader.id, 'coopted', 'Brought into the CEO\'s confidence with a raise.', 3, true);
        return ok(`${fullName(leader)} now answers to you first. ${clique.name} is on the record.`);
      }
      default:
        return ok(`${clique.name} is left alone.`);
    }
  },

  managerFiring(state, item, opt) {
    const m = live(state, item.subjectIds[0]);
    const f = state.people[item.subjectIds[1]];
    if (!m || !f) return gone();
    if (opt === 'overrule') {
      const unitId = hasUnit(state, item.unitId) ? item.unitId : m.unitId;
      if (f.status !== 'active') {
        f.status = 'active';
        f.leftMonth = null;
        f.fate = null;
      }
      if (unitId) placeAsMember(state, f.id, unitId);
      f.satisfaction = clamp(f.satisfaction + 15);
      adjustLoyalty(state, f.id, 20);
      m.satisfaction = clamp(m.satisfaction - 8);
      adjustLoyalty(state, m.id, -6);
      adjustOpinion(state, m.id, f.id, -15);
      addLifeEvent(state, f.id, 'reinstated', `Reinstated by the CEO after ${fullName(m)} fired ${pronoun(f, 'object')}.`, 7, true);
      return ok(`${fullName(f)} is back. ${fullName(m)} has been overruled.`);
    }
    adjustLoyalty(state, m.id, 2);
    adjustLoyalty(state, f.id, -4);
    addLifeEvent(state, f.id, 'dismissalStood', `Appealed a dismissal to the CEO and lost.`, -4, true);
    ripple(state, f.id, -3);
    return ok(`The dismissal of ${fullName(f)} stands.`);
  },

  fixerFallout(state, _item, opt) {
    if (opt === 'deny') {
      if (state.company.cash < 100_000) return no('Not enough cash.');
      state.company.cash -= 100_000;
      state.player.reputation = clamp(state.player.reputation + 2);
      return ok('Legal issues a flat denial. The story loses legs.');
    }
    if (opt === 'hush') {
      if (state.company.cash < 500_000) return no('Not enough cash.');
      state.company.cash -= 500_000;
      state.player.reputation = clamp(state.player.reputation + 4);
      state.company.boardConfidence = clamp(state.company.boardConfidence + 1);
      return ok('The right people are paid. The story dies.');
    }
    return ok('You let it blow over.');
  },

  talentWave(state, item, opt) {
    if (opt !== 'recruit') return ok('You pass. A competitor will sign them.');
    if (state.company.cash < TALENT_RECRUIT_COST) return no('Not enough cash.');
    const teams = Object.values(state.units)
      .filter((u) => (u.kind === 'team' || u.kind === 'subteam') && u.divisionId === item.data.divisionId)
      .sort((a, b) => a.memberIds.length - b.memberIds.length || a.id.localeCompare(b.id));
    if (!teams.length) return no('No team can take them.');
    state.company.cash -= TALENT_RECRUIT_COST;
    const hire = createPerson(state, { role: 'worker', quality: 78 });
    placeAsMember(state, hire.id, teams[0].id);
    hire.hiredMonth = state.month;
    hire.attentionUntil = state.month + ATTENTION_MONTHS;
    hire.attentionReason = 'Awakened recruit';
    addLifeEvent(state, hire.id, 'hired', 'Recruited as the field thinned and awakened talent surfaced.', 5, true);
    return ok(`${fullName(hire)} joins ${teams[0].name}.`);
  },
};

function misconduct(state: GameState, item: InboxItem, opt: string, kind: 'leak' | 'embezzlement' | 'scandal'): ActionResult {
  const p = live(state, item.subjectIds[0]);
  if (!p) return gone();
  const name = fullName(p);
  const noun = { leak: 'the leak', embezzlement: 'the embezzlement', scandal: 'the scandal' }[kind];
  const sev: 1 | 2 | 3 = kind === 'embezzlement' ? 3 : 2;
  switch (opt) {
    case 'fire':
      if (kind === 'embezzlement') revealSecrets(p, ['embezzlement']);
      dismiss(state, p, 'fired', `Dismissed over ${noun}.`);
      addLifeEvent(state, p.id, 'fired', `Fired over ${noun}.`, -8, true);
      ripple(state, p.id, -4);
      return ok(`${name} is fired over ${noun}.`);
    case 'discipline':
      p.satisfaction = clamp(p.satisfaction - 10);
      adjustLoyalty(state, p.id, -4);
      if (kind === 'embezzlement') {
        revealSecrets(p, ['embezzlement']);
        demoteToMember(state, p);
      }
      addLifeEvent(state, p.id, 'disciplined', `Disciplined over ${noun}.`, -3, true);
      return ok(`${name} is disciplined and kept on${kind === 'embezzlement' ? ', stripped of authority' : ''}.`);
    case 'coverUp':
      adjustLoyalty(state, p.id, 18);
      opinionOfCeo(state, p.id, 15);
      p.satisfaction = clamp(p.satisfaction + 5);
      addSecretToPlayer(state, `Buried ${noun} involving ${name}.`, sev, [p.id]);
      addLifeEvent(state, p.id, 'coverUp', `The CEO buried ${noun} ${pronoun(p, 'subject')} was involved in.`, 2, true);
      return ok(`${cap(noun)} disappears. ${name} owes you, and you now have something to hide.`);
    default: // legal
      if (kind === 'embezzlement') {
        revealSecrets(p, ['embezzlement']);
        dismiss(state, p, 'arrested', 'Arrested for embezzlement after Legal referred the case.');
        addLifeEvent(state, p.id, 'arrested', 'Arrested for embezzlement after referral by Legal.', -9, true);
        ripple(state, p.id, -4);
        return ok(`Legal refers ${name} for prosecution. ${cap(pronoun(p, 'subject'))} ${p.pronouns === 'they' ? 'are' : 'is'} arrested.`);
      }
      if (kind === 'leak') {
        dismiss(state, p, 'fired', 'Dismissed under NDA over a leak.');
        addLifeEvent(state, p.id, 'fired', 'Dismissed under NDA over a leak.', -6, true);
        ripple(state, p.id, -3);
        return ok(`Legal dismisses ${name} under NDA and files for an injunction.`);
      }
      p.satisfaction = clamp(p.satisfaction - 8);
      adjustLoyalty(state, p.id, -4);
      addLifeEvent(state, p.id, 'disciplined', 'Disciplined after a scandal, handled by Legal.', -3, true);
      return ok(`Legal contains the scandal. ${name} is formally disciplined and kept on.`);
  }
}

// ---------------------------------------------------------------- public API

function applyResolution(state: GameState, item: InboxItem, optionId: string): ActionResult {
  const handler = handlers[item.kind];
  if (!handler) return no(`No handler for ${item.kind}.`);
  const result = handler(state, item, optionId);
  if (result.ok) item.resolution = optionId;
  return result;
}

/** Applies the player's choice for an inbox item. Costs the option's attention. */
export function resolveInboxItem(state: GameState, itemId: string, optionId: string): ActionResult {
  const item = state.inbox.find((i) => i.id === itemId);
  if (!item) return no('No such inbox item.');
  if (item.resolution !== null) return no('Already handled.');
  const option = item.options.find((o) => o.id === optionId);
  if (!option) return no('No such option.');
  const cost = option.attention ?? 0;
  if (cost > state.player.attentionLeft) return no(`Needs ${cost} attention; you have ${state.player.attentionLeft}.`);
  const result = applyResolution(state, item, optionId);
  if (result.ok) state.player.attentionLeft -= cost;
  return result;
}

/** Auto-resolves unresolved items whose expiresMonth has passed, using their first option. */
export function expireInbox(state: GameState): void {
  // Runs at the end of the turn, before the month counter moves on, so an item
  // expiring "in month m" is settled when month m closes.
  for (const item of state.inbox) {
    if (item.resolution !== null || item.expiresMonth > state.month) continue;
    const first = item.options[0];
    if (!first) continue;
    const result = applyResolution(state, item, first.id);
    if (!result.ok) item.resolution = first.id; // never leave it hanging
    addLog(state, `No response to "${item.title}". Default: ${first.label}. ${result.message}`, 2, item.subjectIds.slice(0, 2));
  }
}
