// The inbox: turns incidents and world news into decisions for the player,
// and applies the consequences of the option chosen. What each kind of
// incident carries is typed in types.ts.
import type {
  ActionResult,
  GameState,
  Incident,
  IncidentKind,
  InboxData,
  InboxItem,
  InboxKind,
  InboxOption,
  Industry,
  Person,
  PersonId,
  Secret,
  UnitId,
} from './types';
import {
  addLifeEvent,
  addLog,
  addSecret,
  adjustLoyalty,
  adjustOpinion,
  adjustSatisfaction,
  be,
  bossOf,
  chainOfCommand,
  formatZuzu,
  fullName,
  functionHead,
  getRelation,
  hasAttention,
  have,
  isActive,
  isLead,
  monthLabel,
  newId,
  opinionOf,
  peopleUnder,
  person,
  placeAsMember,
  pronoun,
  removeFromCompany,
  revealSecrets,
  seatLead,
  secretary,
  setTag,
  unit,
  verb,
  shortName,
} from './org';
import { isTeam, roleRank, salaryBand } from './roles';
import { capitalize, clamp, fail, ok, roundTo } from './util';
import { chance, pick, randInt, random } from './rng';
import { createPerson } from './generate';
import { MARKET_MAX, MARKET_MIN } from './economy';
import { endPlot, plotProgress, setbackPlot } from './plots';
import { makePromise } from './promises';
import { trySpend } from './attention';
import { ripple } from './ties';
import { speak } from './voice';

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

const KIND_PRIORITY: Record<InboxKind, number> = {
  scandal: 8,
  embezzlement: 8,
  leak: 7,
  resignationThreat: 7,
  scheme: 6,
  managerFiring: 6,
  poachOffer: 6,
  fixerFallout: 9,
  tipOff: 7,
  pitch: 6,
  seatVacancy: 8,
  breakthrough: 5,
  feud: 5,
  promotionDemand: 5,
  cliqueFormed: 4,
  complaint: 4,
  raiseDemand: 3,
  talentWave: 3,
};

/** Progress a plot loses when Security watches the plotter, or when the CEO confronts one without leverage. */
const PLOT_WATCH_SETBACK = 20;
const PLOT_CONFRONT_SETBACK = 30;
/** Progress a plot loses when the CEO warns its target away from a pitcher's campaign. */
const PITCH_WARN_SETBACK = 30;
/** Progress a pitcher's plot gains when the CEO backs it. */
const PITCH_BACK_BOOST = 20;
/** Chance a backed pitcher's rival finds out; gossips make it likelier. */
const PITCH_LEAK_CHANCE = 0.3;
const PITCH_LEAK_GOSSIP = 0.2;
/** Thank-you bonus for a tip-off, as a share of yearly salary. */
const TIPOFF_BONUS = 0.05;

/** Share of the gap to 1.0 the market closes each month. */
const MARKET_REVERSION = 0.12;
const RANDOM_NEWS_CHANCE = 0.3;

// Business cycle: downturns (and the odd boom) hit every division at once.
/** No cycle events in the first months, so the opening quarters are readable. */
const CYCLE_START_MONTH = 9;
const RECESSION_CHANCE = 1 / 24;
const RECESSION_DEPTH: [number, number] = [4, 8]; // percent below normal demand
const RECESSION_MONTHS: [number, number] = [7, 12];
const BOOM_CHANCE = 1 / 70;
const BOOM_DEPTH: [number, number] = [3, 6];
const BOOM_MONTHS: [number, number] = [5, 8];
/** Share of the depth that hits demand the month a cycle turns. */
const CYCLE_SHOCK = 0.5;
const RECESSION_HEADLINES = [
  'A credit freeze spreads from the Pacific exchanges; every client is cutting orders.',
  'Grid-wide austerity: the municipal blocs slash contracts and corporate budgets follow.',
  'A run on a major lender triggers a slump in corporate spending.',
];
const BOOM_HEADLINES = [
  'Reconstruction money floods the exchanges; orders are up across the board.',
  'A supply-chain scare drives clients to lock in long contracts early.',
];
const BREAKTHROUGH_BONUS = 0.15; // of yearly salary, paid by the company
const TALENT_RECRUIT_COST = 250_000;
const FALLOUT_DENY_COST = 100_000;
const FALLOUT_HUSH_COST = 500_000;

// ---------------------------------------------------------------- small helpers

const pct = (f: number): string => `${Math.round(f * 100)}%`;

function live(state: GameState, id: PersonId | undefined): Person | null {
  const p = id ? state.people[id] : undefined;
  return p && isActive(p) ? p : null;
}

function titleOf(p: Person): string {
  return p.title || p.role;
}

function giveRaise(p: Person, fraction: number): void {
  p.salary = roundTo(p.salary * (1 + fraction), 100);
}

/** Moves a non-lead into another team, preferring the same division. */
function moveToOtherTeam(state: GameState, p: Person): UnitId | null {
  if (p.unitId === null || isLead(state, p)) return null;
  const here = unit(state, p.unitId);
  const teams = Object.values(state.units).filter(
    (u) => isTeam(u) && u.id !== here.id,
  );
  const sameDiv = teams.filter((u) => u.divisionId !== null && u.divisionId === here.divisionId);
  const pool = sameDiv.length ? sameDiv : teams.filter((u) => u.divisionId !== null);
  if (!pool.length) return null;
  const dest = pick(state, pool);
  placeAsMember(state, p.id, dest.id);
  return dest.id;
}

// ---------------------------------------------------------------- item drafts

interface Draft {
  kind: InboxKind;
  title: string;
  body: string;
  subjectIds: PersonId[];
  unitId: UnitId | null;
  options: InboxOption[];
  data?: InboxData;
  expiryMonths?: number;
  speakerId?: PersonId | null;
  quote?: string;
}

type Builders = { [K in IncidentKind]: (state: GameState, inc: Extract<Incident, { kind: K }>) => Draft | null };

const builders: Builders = {
  raiseDemand(state, inc) {
    const p = live(state, inc.personIds[0]);
    if (!p) return null;
    const ask = clamp(inc.pct, 0.05, 0.4);
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
    const p = live(state, inc.personIds[0]);
    if (!p) return null;
    return {
      kind: 'promotionDemand',
      title: `${fullName(p)} wants a promotion`,
      body: `${fullName(p)} (${titleOf(p)}) believes ${pronoun(p, 'subject')} ${be(p)} ready for more and wants to hear a timetable. Ambition ${p.ambition}, performance ${p.performance}.`,
      subjectIds: [p.id],
      unitId: p.unitId,
      options: [
        { id: 'decline', label: 'Decline', hint: 'Satisfaction and loyalty drop' },
        { id: 'reassign', label: 'Move to a new team', hint: 'A fresh start elsewhere in the company' },
        { id: 'promise', label: 'Promise a promotion in 6 months', hint: 'Tracked promise; breaking it costs you' },
      ],
    };
  },

  seatVacancy(state, inc) {
    const u = inc.unitId ? state.units[inc.unitId] : undefined;
    const cands = u ? seatCandidates(state, u.id) : [];
    if (!u || !cands.length) return null;
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
      unitId: u.id,
      options,
      expiryMonths: SEAT_EXPIRY_MONTHS,
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
    if (t.id === state.player.personId) {
      const prog = plotProgress(state, s.id);
      const how = prog === null ? 'is whispering' : prog >= 75 ? 'has the board half won over' : prog >= 40 ? 'is courting directors' : 'is whispering';
      return {
        kind: 'scheme',
        title: `${fullName(s)} is moving against you`,
        body: `Word reaches you that ${fullName(s)} (${titleOf(s)}) ${how} against your chair. Ambition ${s.ambition}, loyalty ${s.loyalty}.`,
        subjectIds: [s.id, t.id],
        unitId: inc.unitId ?? s.unitId,
        options: [
          { id: 'ignore', label: 'Ignore it', hint: 'The plot keeps building' },
          { id: 'investigate', label: 'Have Security watch', hint: 'Slows the plot and may expose secrets', attention: 1 },
          { id: 'confront', label: `Confront ${fullName(s)}`, hint: 'Works best with leverage in hand', attention: 1 },
        ],
      };
    }
    return {
      kind: 'scheme',
      title: `${fullName(s)} is moving against ${fullName(t)}`,
      body: `Word reaches you that ${fullName(s)} (${titleOf(s)}) is working to undermine ${fullName(t)} (${titleOf(t)}). Ambition ${s.ambition}.`,
      subjectIds: [s.id, t.id],
      unitId: inc.unitId ?? t.unitId,
      options: [
        { id: 'ignore', label: 'Ignore it', hint: 'Politics. Let them sort it out' },
        { id: 'warn', label: `Quietly warn ${fullName(t)}`, hint: `${fullName(t)} grows loyal; ${fullName(s)} may find out` },
        { id: 'investigate', label: 'Have Security watch', hint: 'May expose secrets', attention: 1 },
        { id: 'confront', label: `Confront ${fullName(s)}`, hint: 'Depends on their loyalty', attention: 1 },
      ],
    };
  },

  leak: (state, inc) => buildMisconduct(state, inc),
  embezzlement: (state, inc) => buildMisconduct(state, inc),
  scandal: (state, inc) => buildMisconduct(state, inc),

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
      const better = Object.values(state.units).some((u) => isTeam(u) && u.id !== p.unitId && u.divisionId !== null);
      if (better) options.push({ id: 'move', label: 'Move them to the top team', hint: 'Better unit, bigger stage' });
    } else {
      options.push({ id: 'options', label: 'Grant stock options', hint: 'Ties them to the company' });
    }
    return {
      kind: 'breakthrough',
      title: `${fullName(p)} has delivered`,
      body: `${fullName(p)} (${titleOf(p)}) has delivered. ${inc.detail} ${capitalize(pronoun(p, 'subject'))} can be dealt with directly for a few months.`,
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
      body: `${fullName(p)} (${titleOf(p)}) has put it plainly: change something or ${pronoun(p, 'subject')} ${verb(p, 'leave')}. Loyalty ${p.loyalty}, satisfaction ${p.satisfaction}.`,
      subjectIds: [p.id],
      unitId: p.unitId,
      options: [
        { id: 'letGo', label: 'Let them go', hint: 'They leave the company' },
        { id: 'counter', label: 'Counter-offer: 12% raise', hint: 'Usually works on the greedy' },
        { id: 'appeal', label: 'Appeal to their loyalty', hint: 'Works on the loyal', attention: 1 },
      ],
    };
  },

  poachOffer(state, inc) {
    const p = live(state, inc.personIds[0]);
    if (!p) return null;
    return {
      kind: 'poachOffer',
      title: `A rival is courting ${fullName(p)}`,
      body: `An outside corp has offered ${fullName(p)} (${titleOf(p)}) ${formatZuzu(inc.offer)} a year, against ${formatZuzu(p.salary)} now.`,
      subjectIds: [p.id],
      unitId: p.unitId,
      data: { offer: inc.offer },
      options: [
        { id: 'letGo', label: 'Let them go', hint: 'They take the offer' },
        { id: 'counter', label: `Match ${formatZuzu(inc.offer)}`, hint: 'Keeps them; others may notice' },
        { id: 'appeal', label: 'Appeal to their loyalty', hint: 'No money', attention: 1 },
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
        { id: 'investigate', label: 'Investigate fairly', hint: 'Outcome depends on the facts', attention: 1 },
      ],
    };
  },

  cliqueFormed(state, inc) {
    const leader = live(state, inc.personIds[0]);
    const clique = state.cliques[inc.cliqueId];
    if (!leader || !clique) return null;
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
        { id: 'breakUp', label: 'Break it up', hint: 'The leader resents it', attention: 1 },
      ],
    };
  },

  managerFiring(state, inc) {
    const m = live(state, inc.personIds[0]);
    const f = state.people[inc.personIds[1]];
    if (!m || !f) return null;
    return {
      kind: 'managerFiring',
      title: `${fullName(m)} fired ${fullName(f)}`,
      body: `${fullName(m)} (${titleOf(m)}) has dismissed ${fullName(f)}. ${capitalize(pronoun(f, 'subject'))} ${have(f)} appealed to you.`,
      subjectIds: [m.id, f.id],
      unitId: inc.unitId ?? m.unitId,
      options: [
        { id: 'stand', label: 'Let it stand', hint: `Backs ${fullName(m)}` },
        { id: 'overrule', label: 'Overrule and reinstate', hint: `${fullName(m)} will resent being overruled` },
      ],
    };
  },

  tipOff(state, inc) {
    const i = live(state, inc.personIds[0]);
    const pl = live(state, inc.personIds[1]);
    const t = live(state, inc.personIds[2]);
    if (!i || !pl || !t) return null;
    const vsCeo = t.id === state.player.personId;
    const prog = plotProgress(state, pl.id) ?? 0;
    const stage = prog >= 75 ? 'close to making a move' : prog >= 40 ? 'courting allies' : 'still only whispering';
    return {
      kind: 'tipOff',
      title: `${fullName(i)} warns you about ${fullName(pl)}`,
      body: `${fullName(i)} (${titleOf(i)}) has come to you in confidence: ${fullName(pl)} (${titleOf(pl)}) is campaigning against ${vsCeo ? 'you' : `${fullName(t)} (${titleOf(t)})`}. ${capitalize(they(pl))} ${be(pl)} ${stage}.`,
      subjectIds: [i.id, pl.id, t.id],
      unitId: pl.unitId,
      options: [
        { id: 'note', label: 'Note it', hint: 'They go on your radar; nothing else happens' },
        { id: 'reward', label: 'Thank them properly', hint: `Bonus of ${formatZuzu(Math.round(i.salary * TIPOFF_BONUS))}; they'll keep you informed` },
        { id: 'watch', label: `Have Security watch ${fullName(pl)}`, hint: 'Sets the plot back; may expose a secret', attention: 1 },
      ],
    };
  },

  pitch(state, inc) {
    const p = live(state, inc.personIds[0]);
    const r = live(state, inc.personIds[1]);
    if (!p || !r) return null;
    const tag = getRelation(state, p.id, r.id)?.tag;
    const bad = tag === 'rival' ? 'The two are rivals.' : tag === 'grudge' ? 'The two hold a grudge.' : 'The two have been at odds.';
    const dirt = pitchSecret(r, inc.secretId);
    return {
      kind: 'pitch',
      title: `${fullName(p)} wants your backing against ${fullName(r)}`,
      body: `${fullName(p)} (${titleOf(p)}) wants you on ${pronoun(p, 'possessive')} side against ${fullName(r)} (${titleOf(r)}). ${bad}${dirt ? ` ${fullName(p)} says ${they(p)} can prove ${fullName(r)} is hiding something.` : ''}`,
      subjectIds: [p.id, r.id],
      unitId: p.unitId,
      data: inc.secretId ? { secretId: inc.secretId } : undefined,
      options: [
        { id: 'neutral', label: 'Stay out of it', hint: `${fullName(p)} will be disappointed` },
        { id: 'back', label: `Back ${fullName(p)}`, hint: `They're yours; ${fullName(r)} may find out` },
        ...(dirt ? [{ id: 'dirt', label: `Take what ${fullName(p)} has on ${fullName(r)}`, hint: `Exposes a secret; ${fullName(p)} expects protection` }] : []),
        { id: 'warn', label: `Warn ${fullName(r)}`, hint: `${fullName(r)} grows loyal; ${fullName(p)} will not forgive it` },
      ],
    };
  },

  fixerFallout: (_state, inc) => ({
    kind: 'fixerFallout',
    title: 'Fixer job traced to us',
    body: inc.what,
    subjectIds: [],
    unitId: inc.unitId,
    options: [
      { id: 'blowOver', label: 'Let it blow over', hint: 'Cost already taken' },
      { id: 'deny', label: 'Legal issues a denial', hint: `${formatZuzu(FALLOUT_DENY_COST)}; steadies your reputation` },
      { id: 'hush', label: 'Pay people off', hint: `${formatZuzu(FALLOUT_HUSH_COST)}; quiets it and calms the board` },
    ],
  }),
};

function buildMisconduct(state: GameState, inc: Extract<Incident, { kind: 'leak' | 'embezzlement' | 'scandal' }>): Draft | null {
  const p = live(state, inc.personIds[0]);
  if (!p) return null;
  const kind = inc.kind;
  const copy = {
    leak: { title: `${fullName(p)} leaked company information`, body: 'Security traced a leak of internal material to', hint: 'Dismissed quietly under NDA' },
    embezzlement: { title: `${fullName(p)} is skimming funds`, body: 'The books show money going missing, and the trail leads to', hint: 'Prosecution; arrested' },
    scandal: { title: `Scandal around ${fullName(p)}`, body: 'The press and the floor are talking about', hint: 'Containment and discipline' },
  }[kind];
  const detail = inc.kind === 'leak' ? ` ${inc.detail}` : '';
  return {
    kind,
    title: copy.title,
    body: `${copy.body} ${fullName(p)} (${titleOf(p)}).${detail}`,
    subjectIds: [p.id],
    unitId: p.unitId,
    options: [
      { id: 'legal', label: 'Hand it to Legal', hint: copy.hint },
      { id: 'fire', label: 'Fire them', hint: 'Immediate; ripples through their friends' },
      { id: 'discipline', label: 'Discipline them', hint: 'Keeps them, humbled' },
      { id: 'coverUp', label: 'Cover it up', hint: 'They owe you, but it becomes a secret of yours', attention: 1 },
    ],
  };
}

/** The rival's hidden secret a pitch offers, if it is still hidden. */
function pitchSecret(rival: Person, secretId: string | null | undefined): Secret | null {
  return (secretId && rival.secrets.find((x) => x.id === secretId && !x.revealed)) || null;
}

// --- vacant seat candidates

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
    const sen = roleRank[p.role] * 3;
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
    const op = opinionOf(state, b, id);
    if (op >= 30 && (!best || op > best.op)) best = { id: b, op };
  }
  return best ? fullName(person(state, best.id)) : null;
}

// ---------------------------------------------------------------- voices

/** Who walks into the CEO's office with the matter, and what they say. */
type Voice = (state: GameState, d: Draft) => { speaker: Person | null; lines: string[] } | null | undefined;

const at = (state: GameState, d: Draft, i: number): Person | null => live(state, d.subjectIds[i]);
const they = (p: Person) => pronoun(p, 'subject');
const them = (p: Person) => pronoun(p, 'object');

const voices: Partial<Record<InboxKind, Voice>> = {
  raiseDemand: (state, d) => ({
    speaker: at(state, d, 0),
    lines: [
      "I've looked at what people in my seat make across the street. I'm well under, and I'd like that fixed.",
      `I've carried more than my share and my pay hasn't moved. I'm asking for ${pct(d.data?.ask ?? 0.1)}.`,
      `${pct(d.data?.ask ?? 0.1)}. That's what it takes to bring me in line with the market.`,
    ],
  }),
  promotionDemand: (state, d) => {
    const p = at(state, d, 0);
    const years = p ? Math.max(1, Math.round((state.month - p.hiredMonth) / 12)) : 2;
    return {
      speaker: p,
      lines: [
        `I've done this job for ${years} year${years === 1 ? '' : 's'}. I'm ready for more, and I'd like to hear when.`,
        "I'm not asking for a favour. Look at my numbers and tell me what I'm still waiting for.",
        "People I trained are managing teams now. I'd like to know where I stand.",
      ],
    };
  },
  seatVacancy: (state, d) => {
    const u = d.unitId ? state.units[d.unitId] : undefined;
    return {
      speaker: secretary(state),
      lines: [
        `${u?.name ?? 'That unit'} has nobody at the top. The floor is filling the gap with rumours; you should pick someone.`,
        `Three people think they should run ${u?.name ?? 'it'}. Each of them has someone lobbying for them.`,
      ],
    };
  },
  feud: (state, d) => {
    const b = at(state, d, 1);
    if (!b) return null;
    const where = d.unitId ? state.units[d.unitId]?.name : undefined;
    return {
      speaker: at(state, d, 0),
      lines: [
        `Either ${fullName(b)} goes or I stop pretending to work with ${them(b)}.`,
        `I can't get anything done while ${fullName(b)} undermines every decision I make.`,
        `${fullName(b)} has made it personal. I'm done being the adult in the room.`,
        `Every decision I make${where ? ` in ${where}` : ''} gets reopened by ${fullName(b)}. I can't run work that way.`,
        `${fullName(b)} and I have been through two rounds of mediation. Neither of us has moved, and the team is losing time.`,
        `I've kept a record of the last several incidents with ${fullName(b)}. I'd rather not use it, but I will if I have to.`,
        `${shortName(b)} copies my manager on everything I send. That is a lack of trust, not collaboration.`,
        `My people are being asked to choose between ${shortName(b)} and me. It needs settling before it reaches the numbers.`,
        `${shortName(b)} and I disagree about priorities and neither of us will give way. I need a ruling.`,
        `I won't sign off on anything ${shortName(b)} touches until we agree who owns what.`,
        `${fullName(b)} is routing work around me. If that is the new arrangement, I'd like to hear it from you.`,
      ],
    };
  },
  scheme: (state, d) => {
    const s = at(state, d, 0);
    const t = at(state, d, 1);
    if (!s || !t) return null;
    if (t.id === state.player.personId) {
      return {
        speaker: secretary(state),
        lines: [
          `You should hear this from me first: ${fullName(s)} is moving against you. I don't know how far it has gone.`,
          `${fullName(s)} has been having very friendly lunches with directors. Your name comes up.`,
        ],
      };
    }
    return {
      speaker: t,
      lines: [
        `${fullName(s)} is working on my boss behind my back. I'm not imagining it.`,
        `I know what ${fullName(s)} is up to. I'd like you to know that I know.`,
      ],
    };
  },
  leak: (state, d) => {
    const p = at(state, d, 0);
    return p && {
      speaker: functionHead(state, 'security'),
      lines: [`We traced the leak. It's ${fullName(p)}. Tell me how you want it handled.`, `The documents came from ${fullName(p)}'s terminal. There's no doubt.`],
    };
  },
  embezzlement: (state, d) => {
    const p = at(state, d, 0);
    return p && {
      speaker: functionHead(state, 'finance') ?? functionHead(state, 'security'),
      lines: [`The numbers don't add up, and the trail ends at ${fullName(p)}.`, `Audit flagged it twice. It's ${fullName(p)}, and it's been going on a while.`],
    };
  },
  scandal: (state, d) => {
    const p = at(state, d, 0);
    return p && {
      speaker: functionHead(state, 'legal') ?? secretary(state),
      lines: [`The ${shortName(p)} story will be in the feeds by morning. We need a line.`, `Everyone on the floor is talking about ${fullName(p)}. Decide before the press does.`],
    };
  },
  breakthrough: (state, d) => {
    const p = at(state, d, 0);
    if (!p) return null;
    const bossId = bossOf(state, p.id);
    const boss = bossId && bossId !== state.player.personId ? live(state, bossId) : null;
    return {
      speaker: boss ?? p,
      lines: boss
        ? [`You should know what ${fullName(p)} just did. ${capitalize(they(p))} ${be(p)} the real thing.`, `${fullName(p)} solved something the rest of us had given up on. Don't let a rival poach ${them(p)}.`]
        : ["I think I've cracked it. I wanted you to hear it from me.", "It works. I've checked it three times. It works."],
    };
  },
  resignationThreat: (state, d) => ({
    speaker: at(state, d, 0),
    lines: ["Something changes, or I walk. I mean it.", "I've turned down offers because I thought this place was going somewhere. I'm not sure any more.", "I'm tired. Give me a reason to stay or I'm gone."],
  }),
  poachOffer: (state, d) => ({
    speaker: at(state, d, 0),
    lines: [`They're offering ${formatZuzu(d.data?.offer ?? 0)} a year. I'd rather stay, but give me a reason.`, "A rival made me an offer. I haven't said yes. Yet."],
  }),
  complaint: (state, d) => {
    const m = at(state, d, 1);
    return m && {
      speaker: at(state, d, 0),
      lines: [`${fullName(m)} treats us like furniture. I want it on the record.`, `I tried going through ${fullName(m)}. That's the problem.`],
    };
  },
  cliqueFormed: (state, d) => {
    const c = d.data?.cliqueId ? state.cliques[d.data.cliqueId] : undefined;
    const l = at(state, d, 0);
    return l && c && {
      speaker: secretary(state),
      lines: [`${fullName(l)} has a following now. They call themselves ${c.name}.`, `${c.name} meets after hours. ${fullName(l)} runs it, and it's growing.`],
    };
  },
  managerFiring: (state, d) => {
    const m = at(state, d, 0);
    const f = d.subjectIds[1] ? state.people[d.subjectIds[1]] : undefined;
    return m && f ? {
      speaker: f,
      lines: [`${fullName(m)} fired me. I'm asking you to look at it yourself. That's all.`, `I was let go on ${fullName(m)}'s word alone. I'd like a hearing.`],
    } : null;
  },
  fixerFallout: (state) => ({
    speaker: functionHead(state, 'legal') ?? secretary(state),
    lines: ["The fixer job didn't stay quiet. Someone has our name.", "A journalist called me about that job. How much do we want this to go away?"],
  }),
  talentWave: (state) => ({
    speaker: secretary(state),
    lines: ["The field is thinning and awakened people are walking in off the street. We could sign one before the rivals do."],
  }),
  tipOff: (state, d) => {
    const pl = at(state, d, 1);
    const t = at(state, d, 2);
    if (!pl || !t) return null;
    return {
      speaker: at(state, d, 0),
      lines: t.id === state.player.personId
        ? [`I shouldn't be telling you this. ${fullName(pl)} has been meeting directors, and it's about you.`, `${fullName(pl)} is counting votes on the board. Yours, specifically.`]
        : [`${fullName(pl)} is building a case against ${fullName(t)}. People are being lined up.`, `Watch ${fullName(pl)}. ${capitalize(they(pl))} want${pl.pronouns === 'they' ? '' : 's'} ${fullName(t)}'s seat and ${be(pl)} not being subtle.`],
    };
  },
  pitch: (state, d) => {
    const r = at(state, d, 1);
    const p = at(state, d, 0);
    if (!r || !p) return null;
    const where = p.unitId ? state.units[p.unitId]?.name ?? 'here' : 'here';
    return {
      speaker: p,
      lines: d.data?.secretId
        ? [`I have something on ${fullName(r)} you'll want. I'm offering it to you first.`, `${fullName(r)} isn't clean. I can prove it, if you're on my side.`]
        : [`Let's be honest about ${fullName(r)}: ${they(r)} ${be(r)} holding things back. Back me, and you'll have a friend in ${where}.`, `It's ${fullName(r)} or me. I'd rather you chose before someone else does.`],
    };
  },
};

function voiceFor(state: GameState, d: Draft): Pick<InboxItem, 'speakerId' | 'quote'> {
  const v = voices[d.kind]?.(state, d);
  if (!v?.speaker || (!isActive(v.speaker) && d.kind !== 'managerFiring')) return { speakerId: null };
  return { speakerId: v.speaker.id, quote: speak(v.speaker, state.month, d.kind, v.lines) };
}

// ---------------------------------------------------------------- generateEvents

function itemPriority(state: GameState, d: Draft): number {
  let seniority = 0;
  for (const id of d.subjectIds) {
    const p = state.people[id];
    if (p) seniority = Math.max(seniority, roleRank[p.role]);
  }
  return KIND_PRIORITY[d.kind] + seniority;
}

function draftKey(d: Pick<Draft, 'kind' | 'subjectIds' | 'unitId'>): string {
  return `${d.kind}:${d.subjectIds.slice().sort().join(',')}:${d.unitId ?? ''}`;
}

/** Consumes state.incidents and adds world news; creates inbox items. Clears incidents. */
export function generateEvents(state: GameState): void {
  runWorldNews(state);

  const drafts: Draft[] = [];
  const seen = new Set(state.inbox.filter((i) => i.resolution === null).map(draftKey));
  for (const inc of state.incidents) {
    // The registry is typed so each builder only receives its own kind of incident.
    const build = builders[inc.kind] as (state: GameState, inc: Incident) => Draft | null;
    const d = build(state, inc);
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

const ATTENTION_REASON: Partial<Record<InboxKind, string>> = {
  breakthrough: 'Breakthrough',
  scandal: 'Scandal',
  leak: 'Leak',
  embezzlement: 'Embezzlement inquiry',
};

function createItem(state: GameState, d: Draft): InboxItem {
  const item: InboxItem = {
    id: newId(state, 'i'),
    month: state.month,
    kind: d.kind,
    title: d.title,
    body: d.body,
    subjectIds: d.subjectIds,
    unitId: d.unitId,
    ...voiceFor(state, d),
    options: d.options,
    resolution: null,
    expiresMonth: state.month + (d.expiryMonths ?? EXPIRY_MONTHS),
    data: d.data ?? {},
  };
  state.inbox.push(item);
  // Breakthrough and scandal subjects (often low-level) come to the CEO's attention.
  const main = d.subjectIds[0] ? state.people[d.subjectIds[0]] : undefined;
  const reason = ATTENTION_REASON[d.kind];
  if (main && reason) {
    main.attentionUntil = state.month + ATTENTION_MONTHS;
    main.attentionReason = reason;
  }
  // Once a plot has reached the CEO's desk, the CEO knows about it.
  if (d.kind === 'scheme' || d.kind === 'tipOff') {
    const plotterId = d.kind === 'scheme' ? d.subjectIds[0] : d.subjectIds[1];
    const plot = plotterId ? state.plots[plotterId] : undefined;
    if (plot) plot.known = true;
    const plotter = plotterId ? state.people[plotterId] : undefined;
    if (plotter && !hasAttention(state, plotter)) {
      plotter.attentionUntil = state.month + ATTENTION_MONTHS;
      plotter.attentionReason = 'Suspected of plotting';
    }
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

/** Demand level markets are pulled toward: 1 in normal times, lower in a downturn. */
function cycleLevel(state: GameState): number {
  const m = state.macro;
  return m && state.month < m.until ? 1 - m.depth : 1;
}

function runCycle(state: GameState): void {
  const m = state.macro;
  if (m && state.month >= m.until) {
    state.macro = null;
    if (m.depth > 0) addLog(state, 'The downturn is easing; clients are starting to spend again.', 2);
    else addLog(state, 'The boom is cooling off.', 1);
    return;
  }
  if (m || state.month < CYCLE_START_MONTH) return;
  const recession = chance(state, RECESSION_CHANCE);
  if (!recession && !chance(state, BOOM_CHANCE)) return;
  const depth = (recession ? randInt(state, ...RECESSION_DEPTH) : -randInt(state, ...BOOM_DEPTH)) / 100;
  const months = recession ? randInt(state, ...RECESSION_MONTHS) : randInt(state, ...BOOM_MONTHS);
  state.macro = { depth, until: state.month + months };
  for (const d of Object.values(state.divisions)) d.market = clamp(d.market - depth * CYCLE_SHOCK, MARKET_MIN, MARKET_MAX);
  addLog(state, `${monthLabel(state.month)}: ${pick(state, recession ? RECESSION_HEADLINES : BOOM_HEADLINES)} (${recession ? 'downturn' : 'boom'}, expected to last about ${months} months).`, 3);
}

/** Market drift, the business cycle and the month's headline. Exported for generation, which runs it for the months before the game begins. */
export function runWorldNews(state: GameState): void {
  // Markets drift back toward the cycle's level first, so shocks fade over a few months.
  const level = cycleLevel(state);
  for (const d of Object.values(state.divisions)) {
    d.market = clamp(d.market + (level - d.market) * MARKET_REVERSION, MARKET_MIN, MARKET_MAX);
  }
  runCycle(state);

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
  const delta = (randInt(state, 2, 6) / 100) * (up ? 1 : -1);
  nudgeMarket(state, ind, delta);
  addLog(state, `${monthLabel(state.month)}: ${pick(state, RANDOM_NEWS[ind][up ? 'up' : 'down'])} (${ind} demand ${up ? 'up' : 'down'}).`, 2);
}

/** Awakened talent appears when the field drops; the player may recruit one. */
function offerTalentWave(state: GameState): void {
  const target = Object.values(state.divisions).find((d) => d.industry === 'Manastelliate') ?? Object.values(state.divisions).find((d) => d.industry === 'Pharma');
  if (!target) return;
  const teams = Object.values(state.units).filter((u) => isTeam(u) && u.divisionId === target.unitId);
  if (!teams.length) return;
  createItem(state, {
    kind: 'talentWave',
    title: 'Awakened talent on the market',
    body: `With the field thinning, newly awakened specialists are looking for sponsors. A recruiter can place one in ${unit(state, target.unitId).name} for ${formatZuzu(TALENT_RECRUIT_COST)}.`,
    subjectIds: [],
    unitId: target.unitId,
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

/** A handler about one person (the item's first subject), moot if they have left. */
function forSubject(fn: (state: GameState, item: InboxItem, opt: string, p: Person) => ActionResult): Handler {
  return (state, item, opt) => {
    const p = live(state, item.subjectIds[0]);
    return p ? fn(state, item, opt, p) : gone();
  };
}

/** A handler about two people (the item's first two subjects), moot if either has left. */
function forPair(fn: (state: GameState, item: InboxItem, opt: string, a: Person, b: Person) => ActionResult): Handler {
  return (state, item, opt) => {
    const a = live(state, item.subjectIds[0]);
    const b = live(state, item.subjectIds[1]);
    return a && b ? fn(state, item, opt, a, b) : gone();
  };
}

/** Security watches a plotter: the campaign loses ground, the worst hidden secret may come out and the faction is on the record. */
function watchPlotter(state: GameState, s: Person, t: Person | null, lifeText: string): ActionResult {
  s.investigatedMonth = state.month;
  // Surveillance forces a plotter to lie low.
  const slowed = setbackPlot(state, s.id, PLOT_WATCH_SETBACK);
  const found = s.secrets.filter((x) => !x.revealed).sort((x, y) => y.severity - x.severity)[0];
  const clique = s.cliqueId ? state.cliques[s.cliqueId] : undefined;
  if (clique) clique.known = true;
  const stall = slowed ? ' The campaign stalls under watch.' : '';
  if (found) {
    found.revealed = true;
    addLifeEvent(state, s.id, 'investigated', lifeText, -2, true);
    return ok(`Security finds that ${fullName(s)} is hiding: ${found.description}${stall}`);
  }
  addLifeEvent(state, s.id, 'investigated', lifeText, -1, true);
  const against = t ? (t.id === state.player.personId ? 'you' : fullName(t)) : 'its target';
  return ok(`Security confirms the scheme against ${against} but finds nothing else on ${fullName(s)}.${stall}`);
}

/** Records the pitcher's claim on the CEO's protection, unless one is already open. */
function promiseProtection(state: GameState, p: Person, rival: Person): void {
  if (state.promises.some((x) => x.personId === p.id && x.kind === 'protection' && x.state === 'open')) return;
  makePromise(state, p.id, 'protection', 6, `Backing against ${fullName(rival)}.`);
}

/** Marks two people as rivals, unless either already has a tag for the other. */
function makeRivals(state: GameState, a: Person, b: Person): void {
  if (getRelation(state, a.id, b.id)?.tag || getRelation(state, b.id, a.id)?.tag) return;
  setTag(state, a.id, b.id, 'rival');
  setTag(state, b.id, a.id, 'rival');
}

const handlers: Record<InboxKind, Handler> = {
  raiseDemand: forSubject((state, item, opt, p) => {
    const ask = item.data.ask ?? 0.15;
    const name = fullName(p);
    if (opt === 'grant') {
      giveRaise(p, ask);
      adjustSatisfaction(state, p.id, 12);
      adjustLoyalty(state, p.id, 4);
      addLifeEvent(state, p.id, 'raise', `Granted a ${pct(ask)} raise.`, 4, true);
      return ok(`${name} gets the full ${pct(ask)}. ${capitalize(pronoun(p, 'subject'))} will not forget it.`);
    }
    if (opt === 'counter') {
      giveRaise(p, ask / 2);
      adjustSatisfaction(state, p.id, 3);
      addLifeEvent(state, p.id, 'raise', `Got a ${pct(ask / 2)} raise after asking for ${pct(ask)}.`, 2, true);
      return ok(`${name} takes ${pct(ask / 2)}, with some grumbling.`);
    }
    if (opt === 'promise') {
      makePromise(state, p.id, 'raise', 3, `A ${pct(ask)} raise next quarter.`);
      adjustSatisfaction(state, p.id, 4);
      adjustLoyalty(state, p.id, 2);
      return ok(`You promise ${name} a raise next quarter. It is on the books.`);
    }
    // refuse
    adjustSatisfaction(state, p.id, -8);
    adjustLoyalty(state, p.id, -5);
    addLifeEvent(state, p.id, 'raiseRefused', 'Had a raise request refused.', -2, true);
    if (chance(state, 0.15 + p.greed / 300 + (p.loyalty < 40 ? 0.15 : 0))) {
      state.incidents.push({ kind: 'resignationThreat', personIds: [p.id], unitId: p.unitId });
      return ok(`${name} is refused and takes it badly. Expect more from ${pronoun(p, 'object')}.`);
    }
    return ok(`${name} is refused and says nothing.`);
  }),

  promotionDemand: forSubject((state, _item, opt, p) => {
    const name = fullName(p);
    if (opt === 'promise') {
      makePromise(state, p.id, 'promotion', 6, 'A promotion within six months.');
      adjustLoyalty(state, p.id, 5);
      adjustSatisfaction(state, p.id, 6);
      return ok(`You promise ${name} a promotion within six months.`);
    }
    if (opt === 'reassign') {
      const dest = moveToOtherTeam(state, p);
      if (dest) {
        adjustSatisfaction(state, p.id, 4);
        addLifeEvent(state, p.id, 'reassigned', `Moved to ${unit(state, dest).name} after asking for a promotion.`, 1, true);
        return ok(`${name} moves to ${unit(state, dest).name}.`);
      }
      adjustSatisfaction(state, p.id, -3);
      return ok(`There is nowhere to move ${name}; ${pronoun(p, 'subject')} stays put.`);
    }
    adjustSatisfaction(state, p.id, -8);
    adjustLoyalty(state, p.id, -6);
    addLifeEvent(state, p.id, 'passedOver', 'Told there would be no promotion.', -3, true);
    return ok(`${name} is turned down and does not hide it.`);
  }),

  seatVacancy(state, item, opt) {
    const u = item.unitId ? state.units[item.unitId] : undefined;
    if (!u) return ok('The seat no longer exists.');
    if (opt === 'leave') return ok(`${u.name} stays without a head for now.`);
    const chosen = live(state, opt.replace('seat:', ''));
    if (!chosen) return fail('That candidate has left the company.');
    const oldSeat = chosen.unitId && isLead(state, chosen) ? unit(state, chosen.unitId) : null;
    // If the seat was filled meanwhile, the sitting lead steps down into the unit.
    const old = seatLead(state, u.id, chosen.id);
    if (old) {
      adjustSatisfaction(state, old.id, -10);
      adjustLoyalty(state, old.id, -6);
      addLifeEvent(state, old.id, 'demoted', `Stepped down from leading ${u.name}.`, -4, true);
    }
    const [lo, hi] = salaryBand(chosen.role, state.month);
    chosen.salary = roundTo(clamp(Math.max(chosen.salary * 1.15, lo), lo, Math.max(hi, chosen.salary)), 100);
    adjustSatisfaction(state, chosen.id, 15);
    adjustLoyalty(state, chosen.id, 10);
    addLifeEvent(state, chosen.id, 'promoted', `Named to lead ${u.name}.`, 7, true);
    ripple(state, chosen.id, 0, 6);
    for (const id of item.subjectIds) {
      const other = live(state, id);
      if (!other || other.id === chosen.id) continue;
      adjustSatisfaction(state, other.id, -5);
      adjustLoyalty(state, other.id, -3);
      if (other.ambition > 50) addLifeEvent(state, other.id, 'passedOver', `Passed over for ${u.name}.`, -3, true);
    }
    const tail = oldSeat ? ` ${oldSeat.name} loses its head.` : '';
    return ok(`${fullName(chosen)} now leads ${u.name}.${tail}`);
  },

  feud: forPair((state, item, opt, a, b) => {
    const u = item.unitId ? state.units[item.unitId] : undefined;
    const side = (win: Person, lose: Person): ActionResult => {
      adjustSatisfaction(state, win.id, 6);
      adjustLoyalty(state, win.id, 6);
      adjustSatisfaction(state, lose.id, -8);
      adjustLoyalty(state, lose.id, -8);
      adjustOpinion(state, lose.id, win.id, -10);
      adjustOpinion(state, lose.id, state.player.personId, -10);
      addLifeEvent(state, win.id, 'backed', `Backed by the CEO in a feud with ${fullName(lose)}.`, 3, true);
      addLifeEvent(state, lose.id, 'overruled', `Lost a feud with ${fullName(win)} when the CEO sided against ${pronoun(lose, 'object')}.`, -3, true);
      ripple(state, lose.id, 0, -4);
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
  }),

  scheme: forPair((state, _item, opt, s, t) => {
    const ceoId = state.player.personId;
    switch (opt) {
      case 'warn':
        adjustLoyalty(state, t.id, 6);
        adjustOpinion(state, t.id, s.id, -15);
        if (chance(state, 0.3 + s.skills.guile / 300)) {
          adjustOpinion(state, s.id, t.id, -10);
          return ok(`You warn ${fullName(t)}. ${fullName(s)} learns of it and the two are now open enemies.`);
        }
        return ok(`You warn ${fullName(t)} quietly. ${capitalize(pronoun(t, 'subject'))} ${be(t)} on guard.`);
      case 'investigate':
        return watchPlotter(state, s, t, 'Investigated by Security over a scheme.');
      case 'confront': {
        const leverage = s.secrets.some((x) => x.revealed && x.severity >= 2);
        if (leverage) {
          // Security has already found something: the schemer knows what you hold.
          endPlot(state, s.id);
          adjustLoyalty(state, s.id, 10);
          s.ambition = clamp(s.ambition - 10);
          adjustOpinion(state, s.id, ceoId, -10);
          return ok(`You put what Security found on the table. ${fullName(s)} folds and drops it, and will not forget who holds the file.`);
        }
        if (s.loyalty + (s.traits.includes('cautious') ? 15 : 0) >= 50) {
          endPlot(state, s.id);
          adjustLoyalty(state, s.id, 3);
          s.ambition = clamp(s.ambition - 5);
          return ok(`${fullName(s)} backs down and drops it.`);
        }
        adjustLoyalty(state, s.id, -8);
        adjustOpinion(state, s.id, ceoId, -10);
        const hit = setbackPlot(state, s.id, PLOT_CONFRONT_SETBACK);
        return ok(`${fullName(s)} denies everything and resents being accused.${hit ? ' The scheme goes quiet and loses ground, for now.' : ' The scheme goes quiet, for now.'}`);
      }
      default:
        adjustOpinion(state, s.id, t.id, -5);
        return ok(`You let ${fullName(s)} and ${fullName(t)} work it out.`);
    }
  }),

  tipOff(state, item, opt) {
    const i = live(state, item.subjectIds[0]);
    const pl = live(state, item.subjectIds[1]);
    if (!i || !pl) return gone();
    const ceoId = state.player.personId;
    switch (opt) {
      case 'reward': {
        const bonus = Math.round(i.salary * TIPOFF_BONUS);
        state.company.cash -= bonus;
        adjustLoyalty(state, i.id, 8);
        adjustOpinion(state, i.id, ceoId, 8);
        adjustSatisfaction(state, i.id, 4);
        addLifeEvent(state, i.id, 'rewarded', `Thanked by the CEO with a ${formatZuzu(bonus)} bonus for a warning.`, 2, true);
        return ok(`${fullName(i)} takes ${formatZuzu(bonus)} and will keep you informed. ${fullName(pl)} is on your radar.`);
      }
      case 'watch':
        return watchPlotter(state, pl, live(state, item.subjectIds[2]), 'Investigated by Security after a tip-off.');
      default:
        adjustOpinion(state, i.id, ceoId, 2);
        return ok(`You note ${fullName(i)}'s warning. ${fullName(pl)} is on your radar.`);
    }
  },

  pitch: forPair((state, item, opt, p, r) => {
    const ceoId = state.player.personId;
    switch (opt) {
      case 'back': {
        adjustLoyalty(state, p.id, 10);
        adjustOpinion(state, p.id, ceoId, 10);
        promiseProtection(state, p, r);
        const plot = state.plots[p.id];
        if (plot && plot.targetId === r.id) plot.progress = Math.min(100, plot.progress + PITCH_BACK_BOOST);
        else {
          const boss = bossOf(state, r.id);
          if (boss && boss !== ceoId) {
            adjustOpinion(state, boss, r.id, -8);
            adjustOpinion(state, boss, p.id, 6);
          }
        }
        addLifeEvent(state, p.id, 'backed', `Backed by the CEO against ${fullName(r)}.`, 3, true);
        addLifeEvent(state, r.id, 'undercut', `Lost ground when the CEO backed ${fullName(p)} against ${pronoun(r, 'object')}.`, -2, true);
        const gossip = p.traits.includes('gossip') || r.traits.includes('gossip');
        if (chance(state, PITCH_LEAK_CHANCE + (gossip ? PITCH_LEAK_GOSSIP : 0))) {
          adjustOpinion(state, r.id, ceoId, -15);
          adjustLoyalty(state, r.id, -8);
          makeRivals(state, p, r);
          return ok(`You back ${fullName(p)}. Word gets to ${fullName(r)}, who ${verb(r, 'take')} it as a declaration of war.`);
        }
        return ok(`You back ${fullName(p)}. ${fullName(r)} does not know it yet.`);
      }
      case 'dirt': {
        const sec = pitchSecret(r, item.data.secretId);
        if (!sec) return fail('The secret is already out; there is nothing left to take.');
        sec.revealed = true;
        r.attentionUntil = state.month + ATTENTION_MONTHS;
        r.attentionReason = 'Exposed';
        adjustLoyalty(state, p.id, 4);
        promiseProtection(state, p, r);
        addLifeEvent(state, p.id, 'backed', `Handed the CEO what ${pronoun(p, 'subject')} knew about ${fullName(r)}.`, 2, true);
        addLifeEvent(state, r.id, 'exposed', `Exposed to the CEO by ${fullName(p)}: ${sec.description}`, -4, true);
        return ok(`${fullName(p)} hands over the file. ${fullName(r)} is hiding: ${sec.description} ${capitalize(pronoun(p, 'subject'))} will expect protection.`);
      }
      case 'warn': {
        adjustLoyalty(state, r.id, 8);
        adjustOpinion(state, r.id, ceoId, 8);
        adjustOpinion(state, r.id, p.id, -20);
        makeRivals(state, p, r);
        adjustOpinion(state, p.id, ceoId, -15);
        adjustLoyalty(state, p.id, -10);
        const plot = state.plots[p.id];
        const hit = plot && plot.targetId === r.id && setbackPlot(state, p.id, PITCH_WARN_SETBACK);
        addLifeEvent(state, r.id, 'warned', `Warned by the CEO that ${fullName(p)} was angling against ${pronoun(r, 'object')}.`, 2, true);
        addLifeEvent(state, p.id, 'pitchBurned', `Asked the CEO for backing against ${fullName(r)} and was turned on.`, -3, true);
        return ok(`You warn ${fullName(r)}. ${fullName(p)} learns who talked and is furious.${hit ? ` ${capitalize(pronoun(p, 'possessive'))} campaign loses ground.` : ''}`);
      }
      default:
        adjustSatisfaction(state, p.id, -3);
        adjustOpinion(state, p.id, ceoId, -3);
        return ok(`You stay out of it. ${fullName(p)} had hoped for more.`);
    }
  }),

  leak: (state, item, opt) => misconduct(state, item, opt, 'leak'),
  embezzlement: (state, item, opt) => misconduct(state, item, opt, 'embezzlement'),
  scandal: (state, item, opt) => misconduct(state, item, opt, 'scandal'),

  breakthrough: forSubject((state, _item, opt, p) => {
    const name = fullName(p);
    switch (opt) {
      case 'reward': {
        const bonus = Math.round(p.salary * BREAKTHROUGH_BONUS);
        state.company.cash -= bonus;
        giveRaise(p, 0.1);
        adjustSatisfaction(state, p.id, 15);
        adjustLoyalty(state, p.id, 8);
        addLifeEvent(state, p.id, 'rewarded', `Rewarded with a ${formatZuzu(bonus)} bonus and a raise for a breakthrough.`, 6, true);
        return ok(`${name} gets ${formatZuzu(bonus)} and a 10% raise.`);
      }
      case 'promote': {
        if (!p.unitId || isLead(state, p)) return fail(`${name} already leads.`);
        const u = unit(state, p.unitId);
        const old = seatLead(state, u.id, p.id);
        if (old) {
          adjustSatisfaction(state, old.id, -10);
          adjustLoyalty(state, old.id, -6);
          addLifeEvent(state, old.id, 'demoted', `Replaced as head of ${u.name} by ${name}.`, -4, true);
        }
        p.salary = Math.max(p.salary, salaryBand(p.role, state.month)[0]);
        adjustSatisfaction(state, p.id, 18);
        adjustLoyalty(state, p.id, 10);
        addLifeEvent(state, p.id, 'promoted', `Promoted to lead ${u.name} after a breakthrough.`, 8, true);
        return ok(`${name} now leads ${u.name}${old ? `; ${fullName(old)} steps down` : ''}.`);
      }
      case 'move': {
        if (!p.unitId || isLead(state, p)) return fail(`${name} already leads.`);
        const best = Object.values(state.units)
          .filter((u) => isTeam(u) && u.id !== p.unitId && u.divisionId !== null)
          .sort((x, y) => y.output - x.output || x.id.localeCompare(y.id))[0];
        if (!best) return fail('There is no better unit to move them to.');
        placeAsMember(state, p.id, best.id);
        adjustSatisfaction(state, p.id, 10);
        adjustLoyalty(state, p.id, 5);
        addLifeEvent(state, p.id, 'reassigned', `Moved to ${best.name} after a breakthrough.`, 5, true);
        return ok(`${name} moves to ${best.name}, the strongest team in the company.`);
      }
      case 'options':
        p.stockOptions += 2_000;
        adjustSatisfaction(state, p.id, 8);
        adjustLoyalty(state, p.id, 6);
        addLifeEvent(state, p.id, 'rewarded', 'Granted stock options for a breakthrough.', 5, true);
        return ok(`${name} is granted 2,000 options.`);
      default:
        adjustSatisfaction(state, p.id, 2);
        addLifeEvent(state, p.id, 'noted', 'The CEO noted a breakthrough.', 1, true);
        return ok(`You note ${name}'s work.`);
    }
  }),

  resignationThreat: forSubject((state, _item, opt, p) => {
    const name = fullName(p);
    if (opt === 'counter') {
      giveRaise(p, 0.12);
      adjustSatisfaction(state, p.id, 15);
      adjustLoyalty(state, p.id, 4);
      addLifeEvent(state, p.id, 'raise', 'Persuaded to stay with a 12% raise.', 4, true);
      return ok(`${name} takes the money and stays.`);
    }
    if (opt === 'appeal') {
      if (random(state) * 100 < p.loyalty + (p.traits.includes('generous') ? 5 : 0)) {
        adjustSatisfaction(state, p.id, 10);
        adjustLoyalty(state, p.id, 6);
        addLifeEvent(state, p.id, 'retained', 'Talked into staying by the CEO.', 3, true);
        return ok(`You reach ${name}. ${capitalize(pronoun(p, 'subject'))} ${verb(p, 'stay')}.`);
      }
      removeFromCompany(state, p.id, 'quit', "Resigned over the CEO's head and left the company.");
      addLifeEvent(state, p.id, 'quit', "Resigned despite the CEO's appeal.", -3, true);
      ripple(state, p.id, 0, -3);
      return ok(`${name} listens and leaves anyway.`);
    }
    removeFromCompany(state, p.id, 'quit', 'Resigned after the CEO let the threat stand.');
    addLifeEvent(state, p.id, 'quit', `Resigned when the CEO let ${pronoun(p, 'object')} go.`, -2, true);
    ripple(state, p.id, 0, -3);
    return ok(`${name} resigns.`);
  }),

  poachOffer: forSubject((state, item, opt, p) => {
    const name = fullName(p);
    const offer = item.data.offer ?? p.salary * 1.25;
    if (opt === 'counter') {
      const raise = Math.max(0, offer - p.salary);
      p.salary = roundTo(offer, 100);
      adjustSatisfaction(state, p.id, 8);
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
      removeFromCompany(state, p.id, 'defected', 'Joined a rival corporation.');
      addLifeEvent(state, p.id, 'defected', "Left for a rival corporation despite the CEO's appeal.", 1, true);
      ripple(state, p.id, 0, -3);
      return ok(`${name} thanks you and takes the rival's offer.`);
    }
    removeFromCompany(state, p.id, 'defected', 'Joined a rival corporation.');
    addLifeEvent(state, p.id, 'defected', 'Left for a rival corporation.', 2, true);
    ripple(state, p.id, 0, -3);
    return ok(`${name} leaves for the rival.`);
  }),

  complaint: forPair((state, item, opt, c, m) => {
    const u = item.unitId ? state.units[item.unitId] : undefined;
    const backC = (why: string): ActionResult => {
      adjustSatisfaction(state, c.id, 10);
      adjustLoyalty(state, c.id, 6);
      adjustSatisfaction(state, m.id, -8);
      adjustLoyalty(state, m.id, -6);
      adjustOpinion(state, m.id, c.id, -20);
      adjustOpinion(state, m.id, state.player.personId, -8);
      addLifeEvent(state, c.id, 'vindicated', `Complaint against ${fullName(m)} upheld.`, 4, true);
      addLifeEvent(state, m.id, 'censured', `Censured after a complaint from ${fullName(c)}.`, -3, true);
      if (u) u.morale = clamp(u.morale + 3);
      return ok(why);
    };
    const backM = (why: string): ActionResult => {
      adjustSatisfaction(state, m.id, 3);
      adjustLoyalty(state, m.id, 4);
      adjustSatisfaction(state, c.id, -10);
      adjustLoyalty(state, c.id, -5);
      adjustOpinion(state, c.id, m.id, -10);
      addLifeEvent(state, c.id, 'dismissed', 'Complaint brushed aside by the CEO.', -3, true);
      if (chance(state, 0.2)) state.incidents.push({ kind: 'resignationThreat', personIds: [c.id], unitId: c.unitId });
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
        adjustSatisfaction(state, c.id, -6);
        adjustLoyalty(state, c.id, -2);
        return ok('The complaint is filed and nothing happens.');
    }
  }),

  cliqueFormed: forSubject((state, item, opt, leader) => {
    const clique = item.data.cliqueId ? state.cliques[item.data.cliqueId] : undefined;
    if (!clique) return ok('The faction has dissolved on its own.');
    switch (opt) {
      case 'breakUp': {
        for (const id of clique.memberIds) {
          const m = state.people[id];
          if (!m) continue;
          m.cliqueId = null;
          adjustSatisfaction(state, id, -3);
        }
        delete state.cliques[clique.id];
        adjustLoyalty(state, leader.id, -6);
        adjustOpinion(state, leader.id, state.player.personId, -10);
        addLifeEvent(state, leader.id, 'clique', `The CEO broke up ${clique.name}.`, -2, true);
        return ok(`${clique.name} is broken up. ${fullName(leader)} resents it.`);
      }
      case 'coopt': {
        giveRaise(leader, 0.08);
        adjustLoyalty(state, leader.id, 10);
        adjustOpinion(state, leader.id, state.player.personId, 10);
        for (const id of clique.memberIds) if (id !== leader.id && state.people[id]) adjustLoyalty(state, id, 3);
        clique.known = true;
        addLifeEvent(state, leader.id, 'coopted', "Brought into the CEO's confidence with a raise.", 3, true);
        return ok(`${fullName(leader)} now answers to you first. ${clique.name} is on the record.`);
      }
      default:
        return ok(`${clique.name} is left alone.`);
    }
  }),

  managerFiring(state, item, opt) {
    const m = live(state, item.subjectIds[0]);
    const f = state.people[item.subjectIds[1]];
    if (!m || !f) return gone();
    if (opt === 'overrule') {
      const unitId = item.unitId && state.units[item.unitId] ? item.unitId : m.unitId;
      if (f.status !== 'active') {
        f.status = 'active';
        f.leftMonth = null;
        f.fate = null;
      }
      if (unitId) placeAsMember(state, f.id, unitId);
      adjustSatisfaction(state, f.id, 15);
      adjustLoyalty(state, f.id, 20);
      adjustSatisfaction(state, m.id, -8);
      adjustLoyalty(state, m.id, -6);
      adjustOpinion(state, m.id, f.id, -15);
      addLifeEvent(state, f.id, 'reinstated', `Reinstated by the CEO after ${fullName(m)} fired ${pronoun(f, 'object')}.`, 7, true);
      return ok(`${fullName(f)} is back. ${fullName(m)} has been overruled.`);
    }
    adjustLoyalty(state, m.id, 2);
    adjustLoyalty(state, f.id, -4);
    addLifeEvent(state, f.id, 'dismissalStood', 'Appealed a dismissal to the CEO and lost.', -4, true);
    ripple(state, f.id, 0, -3);
    return ok(`The dismissal of ${fullName(f)} stands.`);
  },

  fixerFallout(state, _item, opt) {
    if (opt === 'deny') {
      if (state.company.cash < FALLOUT_DENY_COST) return fail('Not enough cash.');
      state.company.cash -= FALLOUT_DENY_COST;
      state.player.reputation = clamp(state.player.reputation + 2);
      return ok('Legal issues a flat denial. The story loses legs.');
    }
    if (opt === 'hush') {
      if (state.company.cash < FALLOUT_HUSH_COST) return fail('Not enough cash.');
      state.company.cash -= FALLOUT_HUSH_COST;
      state.player.reputation = clamp(state.player.reputation + 4);
      state.company.boardConfidence = clamp(state.company.boardConfidence + 1);
      return ok('The right people are paid. The story dies.');
    }
    return ok('You let it blow over.');
  },

  talentWave(state, item, opt) {
    if (opt !== 'recruit') return ok('You pass. A competitor will sign them.');
    if (state.company.cash < TALENT_RECRUIT_COST) return fail('Not enough cash.');
    const teams = Object.values(state.units)
      .filter((u) => isTeam(u) && u.divisionId === item.unitId)
      .sort((a, b) => a.memberIds.length - b.memberIds.length || a.id.localeCompare(b.id));
    if (!teams.length) return fail('No team can take them.');
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
  switch (opt) {
    case 'fire':
      if (kind === 'embezzlement') revealSecrets(p, ['embezzlement']);
      removeFromCompany(state, p.id, 'fired', `Dismissed over ${noun}.`);
      addLifeEvent(state, p.id, 'fired', `Fired over ${noun}.`, -8, true);
      ripple(state, p.id, 0, -4);
      return ok(`${name} is fired over ${noun}.`);
    case 'discipline':
      adjustSatisfaction(state, p.id, -10);
      adjustLoyalty(state, p.id, -4);
      if (kind === 'embezzlement') {
        revealSecrets(p, ['embezzlement']);
        if (isLead(state, p)) placeAsMember(state, p.id, p.unitId!);
      }
      addLifeEvent(state, p.id, 'disciplined', `Disciplined over ${noun}.`, -3, true);
      return ok(`${name} is disciplined and kept on${kind === 'embezzlement' ? ', stripped of authority' : ''}.`);
    case 'coverUp':
      adjustLoyalty(state, p.id, 18);
      adjustOpinion(state, p.id, state.player.personId, 15);
      adjustSatisfaction(state, p.id, 5);
      addSecret(state, state.player.personId, {
        kind: 'coverUp',
        description: `Buried ${noun} involving ${name}.`,
        severity: kind === 'embezzlement' ? 3 : 2,
        involvedIds: [p.id],
      });
      addLifeEvent(state, p.id, 'coverUp', `The CEO buried ${noun} ${pronoun(p, 'subject')} was involved in.`, 2, true);
      return ok(`${capitalize(noun)} disappears. ${name} owes you, and you now have something to hide.`);
    default: // legal
      if (kind === 'embezzlement') {
        revealSecrets(p, ['embezzlement']);
        removeFromCompany(state, p.id, 'arrested', 'Arrested for embezzlement after Legal referred the case.');
        addLifeEvent(state, p.id, 'arrested', 'Arrested for embezzlement after referral by Legal.', -9, true);
        ripple(state, p.id, 0, -4);
        return ok(`Legal refers ${name} for prosecution. ${capitalize(pronoun(p, 'subject'))} ${be(p)} arrested.`);
      }
      if (kind === 'leak') {
        removeFromCompany(state, p.id, 'fired', 'Dismissed under NDA over a leak.');
        addLifeEvent(state, p.id, 'fired', 'Dismissed under NDA over a leak.', -6, true);
        ripple(state, p.id, 0, -3);
        return ok(`Legal dismisses ${name} under NDA and files for an injunction.`);
      }
      adjustSatisfaction(state, p.id, -8);
      adjustLoyalty(state, p.id, -4);
      addLifeEvent(state, p.id, 'disciplined', 'Disciplined after a scandal, handled by Legal.', -3, true);
      return ok(`Legal contains the scandal. ${name} is formally disciplined and kept on.`);
  }
}

// ---------------------------------------------------------------- public API

function applyResolution(state: GameState, item: InboxItem, optionId: string): ActionResult {
  const result = handlers[item.kind](state, item, optionId);
  if (result.ok) item.resolution = optionId;
  return result;
}

/** Applies the player's choice for an inbox item. Costs the option's attention. */
export function resolveInboxItem(state: GameState, itemId: string, optionId: string): ActionResult {
  const item = state.inbox.find((i) => i.id === itemId);
  if (!item) return fail('No such inbox item.');
  if (item.resolution !== null) return fail('Already handled.');
  const option = item.options.find((o) => o.id === optionId);
  if (!option) return fail('No such option.');
  const cost = option.attention ?? 0;
  const blocked = trySpend(state, cost);
  if (blocked) return blocked;
  const result = applyResolution(state, item, optionId);
  if (!result.ok) state.player.attentionLeft += cost;
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
