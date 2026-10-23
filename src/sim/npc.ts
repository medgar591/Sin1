// What the people do on their own each month: work, relationships drifting,
// satisfaction, cliques, scheming, managers hiring/firing/promoting inside
// their units, quitting and defecting. Anything that may need the player is
// pushed to state.incidents for events.ts.
import type {
  Clique,
  GameState,
  Incident,
  IncidentKind,
  LifeEvent,
  Person,
  PersonId,
  RelTag,
  Role,
  Secret,
  UnitId,
  OrgUnit,
} from './types';
import {
  activeStaff,
  addLifeEvent,
  addLog,
  adjustOpinion,
  bossOf,
  chainOfCommand,
  clamp,
  fullName,
  getRelation,
  isActive,
  newId,
  opinionOf,
  peopleUnder,
  person,
  placeAsMember,
  pronoun,
  removeFromCompany,
  setLead,
  setTag,
  unit,
} from './org';
import { chance, gaussian, pick, random, randInt, weightedPick } from './rng';
import { createPerson, marketSalary } from './generate';

/** Tuning knobs. Exported (and mutable) so tests and balancing can adjust them. */
export const npcTuning = {
  // Satisfaction
  satisfactionRate: 0.25,
  payWeight: 80,
  // Incidents
  maxIncidentsPerMonth: 6,
  // Relationships
  newRelationChance: 0.05,
  feudStep: 2.5,
  feudIncidentOpinion: -75,
  maxProteges: 3,
  // Scheming
  schemeBase: 0.14,
  schemeMinInvolvement: 25,
  schemeMinAmbition: 35,
  maxCliques: 14,
  leakWeight: 0.25,
  embezzleDiscoverChance: 0.035,
  // Plotting
  plotBase: 0.05,
  plotMinAmbition: 55,
  plotMinInvolvement: 35,
  plotGain: 2.5,
  plotCaughtChance: 0.02,
  plotNoticeChance: 0.55,
  plotStages: [40, 75] as number[],
  // Managers
  fireChance: 0.35,
  firePerformance: 35,
  fireMinTenure: 6,
  warnChance: 0.5,
  pullChance: 0.5,
  protectOpinion: 40,
  fillChance: 0.7,
  externalLeadChance: 0.4,
  hireChance: 0.4,
  raiseChance: 0.25,
  seatDemandChance: 0.6,
  passedOverAmbition: 50,
  // Requests
  raiseDemandChance: 0.1,
  promotionDemandChance: 0.04,
  resignThreatChance: 0.15,
  complaintChance: 0.08,
  // Leaving
  quitSatisfaction: 22,
  quitChance: 0.3,
  // Events
  breakthroughChance: 0.004,
  scandalChance: 0.006,
};
const T = npcTuning;

/** Extra fields this module keeps on the otherwise-JSON game state. */
interface Plot {
  targetId: PersonId;
  progress: number;
  stage: number;
}
type NpcCliqueData = Clique & { momentum?: number };
type NpcState = GameState & {
  npcPlots?: Record<PersonId, Plot>;
  npcUnitSizes?: Record<UnitId, number>;
};

interface Candidate {
  incident: Incident;
  priority: number;
  commit?: () => void;
}
interface Ctx {
  s: NpcState;
  out: Candidate[];
  pay: Map<PersonId, number>;
}

const RANK: Record<Role, number> = {
  ceo: 10,
  chair: 9,
  director: 9,
  officer: 8,
  divisionHead: 6,
  subdivisionHead: 5,
  teamLead: 4,
  subteamLead: 3,
  worker: 1,
};
const KIND_WEIGHT: Record<IncidentKind, number> = {
  raiseDemand: 3,
  promotionDemand: 4,
  feud: 4,
  scheme: 6,
  leak: 5,
  embezzlement: 7,
  breakthrough: 5,
  scandal: 6,
  resignationThreat: 5,
  poachOffer: 6,
  complaint: 3,
  cliqueFormed: 3,
  managerFiring: 4,
};
const RIVAL_CORPS = ['Kessler-Ono', 'Vantage Meridian', 'Ashgrove Combine', 'Tidewater Group', 'Halden Strand', 'Orrery Holdings'];
const QUIT_FATES = [
  'Took a job at a logistics firm in the sprawl.',
  'Moved to a smaller firm with shorter hours.',
  'Left the corporate track and opened a repair shop.',
  'Went freelance as a grid consultant.',
  'Joined a municipal contractor across the river.',
  'Took a position at a regional clinic network.',
];
const CLIQUE_A = ['Night Shift', 'Ninth Floor', 'Old Guard', 'Back Table', 'Second Wave', 'Lunch Club', 'Sub-Level', 'Straight Talkers'];
const CLIQUE_B = ['Circle', 'Bloc', 'Table', 'Crew', 'Group'];
const CLIQUE_AGENDAS = [
  'Back each other for promotion.',
  'Keep management honest about workloads.',
  'Push out the current lead.',
  'Protect their own when cuts come.',
];
const BREAKTHROUGHS = [
  'Reworked the unit process and cut cycle time by a fifth.',
  'Found a fault in a long-trusted procedure before it caused losses.',
  'Built a tool that the whole division has started to use.',
  'Closed a stalled contract that three managers had given up on.',
];

// ---------------------------------------------------------------- helpers

const has = (p: Person, t: Person['traits'][number]): boolean => p.traits.includes(t);
const rank = (p: Person): number => RANK[p.role];
const isManager = (p: Person): boolean => rank(p) >= 3;
const quality = (p: Person): number =>
  isManager(p) ? (p.skills.work + p.skills.management) / 2 : p.skills.work;
const tenure = (ctx: Ctx, p: Person): number => ctx.s.month - p.hiredMonth;
const roundPay = (n: number): number => Math.round(n / 500) * 500;
const isStaff = (p: Person | undefined): p is Person => !!p && isActive(p) && p.unitId !== null && p.role !== 'ceo';

function marketPay(ctx: Ctx, p: Person): number {
  let v = ctx.pay.get(p.id);
  if (v === undefined) {
    v = marketSalary(p.role, quality(p));
    ctx.pay.set(p.id, v);
  }
  return v;
}

/** Most recent life event of a kind (scans a bounded tail of the history). */
function lastEvent(p: Person, kind: string): LifeEvent | undefined {
  for (let i = p.history.length - 1, n = 0; i >= 0 && n < 60; i--, n++) {
    if (p.history[i].kind === kind) return p.history[i];
  }
  return undefined;
}
function recent(ctx: Ctx, p: Person, kind: string, months: number): boolean {
  const e = lastEvent(p, kind);
  return !!e && ctx.s.month - e.month <= months;
}
function recentCount(ctx: Ctx, p: Person, kind: string, months: number): number {
  let c = 0;
  for (let i = p.history.length - 1; i >= 0; i--) {
    const e = p.history[i];
    if (ctx.s.month - e.month > months) break;
    if (e.kind === kind) c++;
  }
  return c;
}
function recentImpact(ctx: Ctx, p: Person): number {
  let sum = 0;
  for (let i = p.history.length - 1; i >= 0; i--) {
    const e = p.history[i];
    const age = ctx.s.month - e.month;
    if (age > 5) break;
    if (e.kind === 'passedOver') continue; // counted on its own
    sum += e.impact * (1 - age / 6);
  }
  return sum;
}

function raise(ctx: Ctx, kind: IncidentKind, actor: Person, personIds: PersonId[], data: Record<string, unknown>, extra = 0, commit?: () => void): void {
  ctx.out.push({
    incident: { kind, personIds, unitId: actor.unitId, data },
    priority: rank(actor) + KIND_WEIGHT[kind] + extra,
    commit,
  });
}

function titleFor(role: Role, u: OrgUnit): string {
  const label: Partial<Record<Role, string>> = {
    teamLead: 'Team Lead',
    subteamLead: 'Sub-team Lead',
    subdivisionHead: 'Sub-division Head',
  };
  return label[role] ? `${label[role]}, ${u.name}` : `Staff, ${u.name}`;
}

function clique(s: NpcState, id: string | null): NpcCliqueData | null {
  return id ? ((s.cliques[id] as NpcCliqueData | undefined) ?? null) : null;
}

/** Nearest active lead above a unit (including the unit's own lead). */
function managerOfUnit(s: GameState, u: OrgUnit): Person | null {
  let cur: OrgUnit | null = u;
  while (cur) {
    if (cur.leadId && isActive(person(s, cur.leadId))) return person(s, cur.leadId);
    cur = cur.parentId ? unit(s, cur.parentId) : null;
  }
  return null;
}

function leave(ctx: Ctx, p: Person, status: 'quit' | 'defected' | 'fired', fate: string): void {
  delete ctx.s.npcPlots?.[p.id];
  removeFromCompany(ctx.s, p.id, status, fate);
}

// ----------------------------------------------------------- satisfaction

function updateSatisfaction(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  const u = unit(s, p.unitId!);
  const ratio = p.salary / Math.max(1, marketPay(ctx, p));
  const pay = clamp((ratio - 1) * T.payWeight, -25, 12) * (0.6 + (p.greed / 100) * 0.8);
  const boss = bossOf(s, p.id);
  const bossTerm = boss ? opinionOf(s, p.id, boss) * 0.15 : 0;
  const morale = (u.morale - 50) * 0.3;
  const events = clamp(recentImpact(ctx, p) * 0.8, -20, 15);
  const passed = -4 * (0.5 + p.ambition / 100) * recentCount(ctx, p, 'passedOver', 6);
  const cl = clique(s, p.cliqueId);
  const cliqueTerm = clamp((cl?.momentum ?? 0) * 2, -6, 6);
  const target = 55 + pay + bossTerm + morale + events + passed + cliqueTerm;
  p.satisfaction = clamp(p.satisfaction + (target - p.satisfaction) * T.satisfactionRate + (random(s) - 0.5) * 2);
}

// ---------------------------------------------------------- relationships

function matesOf(s: GameState, p: Person): PersonId[] {
  const u = unit(s, p.unitId!);
  const pool = u.leadId && u.leadId !== p.id ? [u.leadId, ...u.memberIds] : u.memberIds;
  return pool.filter((id) => id !== p.id);
}

function randomMate(s: GameState, p: Person): Person | null {
  const pool = matesOf(s, p);
  if (!pool.length) return null;
  const o = s.people[pick(s, pool)];
  return isStaff(o) ? o : null;
}

function pickAssociate(ctx: Ctx, p: Person): Person | null {
  const s = ctx.s;
  const r = random(s);
  let o: Person | undefined;
  if (r < 0.5) o = randomMate(s, p) ?? undefined;
  else if (r < 0.72) {
    const chain = chainOfCommand(s, p.id).slice(0, 3);
    if (chain.length) o = s.people[pick(s, chain)];
  } else if (r < 0.88) {
    // A peer: sibling lead for leads, workmate otherwise.
    const u = unit(s, p.unitId!);
    if (u.leadId === p.id && u.parentId) {
      const sibs = unit(s, u.parentId).childIds.map((c) => unit(s, c).leadId).filter((id): id is string => !!id && id !== p.id);
      if (sibs.length) o = s.people[pick(s, sibs)];
    } else o = randomMate(s, p) ?? undefined;
  } else {
    const u = unit(s, p.unitId!);
    if (u.leadId === p.id && u.memberIds.length) o = s.people[pick(s, u.memberIds)];
  }
  return isStaff(o) ? o : null;
}

function sharedArena(s: GameState, a: Person, b: Person): boolean {
  if (a.unitId === b.unitId) return true;
  const ua = unit(s, a.unitId!);
  const ub = unit(s, b.unitId!);
  if (ua.parentId && ua.parentId === ub.parentId) return true;
  return bossOf(s, a.id) === b.id || bossOf(s, b.id) === a.id;
}

function traitDelta(s: GameState, a: Person, b: Person): number {
  let d = gaussian(s) * 0.7;
  if (has(a, 'petty')) d -= 0.8;
  if (has(a, 'gossip')) d -= 0.5;
  if (has(b, 'charming')) d += 0.8;
  if (has(a, 'generous')) d += 0.6;
  if (has(a, 'diligent') && b.performance < 40) d -= 0.6;
  if (has(a, 'lazy') && has(b, 'diligent')) d -= 0.4;
  if (has(a, 'principled') && has(b, 'ruthless')) d -= 0.8;
  if (has(a, 'vain') && !has(b, 'charming')) d -= 0.3;
  return d;
}

function tendRelations(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  const row = s.relations[p.id];
  if (row) {
    for (const [oid, rel] of Object.entries(row)) {
      const o = s.people[oid];
      if (!o || !isActive(o)) continue;
      if (rel.tag === 'rival' || rel.tag === 'grudge') {
        // Feuds only escalate while the pair still shares an arena.
        if (isStaff(o) && sharedArena(s, p, o)) {
          rel.opinion = clamp(rel.opinion - T.feudStep * (0.5 + random(s)), -100, 100);
          if (rel.opinion <= T.feudIncidentOpinion && rel.tag === 'rival' && p.id < o.id) escalateFeud(ctx, p, o);
        }
      } else if (rel.tag) {
        if (rel.opinion < 55) rel.opinion += 0.5;
      } else if (Math.abs(rel.opinion) < 3) {
        delete row[oid]; // forgotten; keeps the relation table sparse
      } else {
        rel.opinion *= 0.97;
        if (rel.opinion >= 65) rel.tag = 'friend';
        else if (rel.opinion <= -65) rel.tag = 'grudge';
      }
    }
  }
  const boss = bossOf(s, p.id);
  if (boss) {
    const b = person(s, boss);
    const u = unit(s, p.unitId!);
    let up = (b.skills.management - 50) / 40 + (u.morale - 50) / 60 + (b.performance - 50) / 80;
    up += p.satisfaction < 40 ? -0.5 : 0.2;
    if (has(p, 'petty')) up -= 0.4;
    adjustOpinion(s, p.id, boss, up + gaussian(s) * 0.4);
    let down = (p.performance - 50) / 40 + (has(p, 'charming') ? 0.4 : 0) - (has(p, 'lazy') ? 0.3 : 0);
    if (has(b, 'generous')) down += 0.3;
    adjustOpinion(s, boss, p.id, down + gaussian(s) * 0.4);
  }
  const mate = randomMate(s, p);
  if (mate) {
    const d = traitDelta(s, p, mate);
    if (Math.abs(d) > 0.5 || getRelation(s, p.id, mate.id)) adjustOpinion(s, p.id, mate.id, d);
  }
}

function escalateFeud(ctx: Ctx, a: Person, b: Person): void {
  if (recent(ctx, a, 'feud', 6) || recent(ctx, b, 'feud', 6)) return;
  const text = (o: Person) => `Locked in an open feud with ${fullName(o)}.`;
  addLifeEvent(ctx.s, a.id, 'feud', text(b), -3, false);
  addLifeEvent(ctx.s, b.id, 'feud', text(a), -3, false);
  addLog(ctx.s, `${fullName(a)} and ${fullName(b)} are in an open feud.`, 2, [a.id, b.id]);
  raise(ctx, 'feud', rank(a) >= rank(b) ? a : b, [a.id, b.id], {});
}

function protegeCount(s: GameState, p: Person): number {
  let n = 0;
  for (const r of Object.values(s.relations[p.id] ?? {})) if (r.tag === 'protege') n++;
  return n;
}

function formRelation(ctx: Ctx, a: Person): void {
  const s = ctx.s;
  if (!chance(s, T.newRelationChance + (a.involvement / 100) * 0.05)) return;
  const b = pickAssociate(ctx, a);
  if (!b || getRelation(s, a.id, b.id)?.tag || getRelation(s, b.id, a.id)?.tag) return;
  const [hi, lo] = rank(a) >= rank(b) ? [a, b] : [b, a];
  const inLine = chainOfCommand(s, lo.id).includes(hi.id);
  const mentorOk = inLine && rank(hi) > rank(lo) && lo.performance >= 65 && hi.skills.management >= 45 && protegeCount(s, hi) < T.maxProteges;
  const rivalOk = a.ambition >= 40 && b.ambition >= 40 && rank(a) === rank(b);
  const loverOk = Math.abs(a.age - b.age) <= 20 && !a.traits.includes('principled') && !b.traits.includes('principled');
  const kind = weightedPick(s, ['friend', 'rival', 'lover', 'mentor'] as const, (k) =>
    k === 'friend' ? 50 : k === 'rival' ? (rivalOk ? 25 : 0) : k === 'lover' ? (loverOk ? 5 : 0) : mentorOk ? 40 : 0,
  );
  const both = (tag: RelTag, op: number) => {
    setTag(s, a.id, b.id, tag);
    setTag(s, b.id, a.id, tag);
    adjustOpinion(s, a.id, b.id, op - opinionOf(s, a.id, b.id));
    adjustOpinion(s, b.id, a.id, op - opinionOf(s, b.id, a.id));
  };
  if (kind === 'friend') both('friend', randInt(s, 45, 65));
  else if (kind === 'rival') {
    both('rival', -randInt(s, 35, 50));
    addLifeEvent(s, a.id, 'rival', `Became rivals with ${fullName(b)}.`, -1, false);
    addLifeEvent(s, b.id, 'rival', `Became rivals with ${fullName(a)}.`, -1, false);
  } else if (kind === 'lover') {
    both('lover', randInt(s, 55, 75));
    if (inLine) addAffair(ctx, a, b);
  } else {
    // relations[x][y].tag labels y from x's point of view.
    setTag(s, hi.id, lo.id, 'protege');
    setTag(s, lo.id, hi.id, 'mentor');
    adjustOpinion(s, hi.id, lo.id, Math.max(0, 40 - opinionOf(s, hi.id, lo.id)));
    adjustOpinion(s, lo.id, hi.id, Math.max(0, 45 - opinionOf(s, lo.id, hi.id)));
    addLifeEvent(s, lo.id, 'mentor', `${fullName(hi)} took ${pronoun(lo, 'object')} under ${pronoun(hi, 'possessive')} wing.`, 3, false);
    if (rank(hi) >= 6) addLog(s, `${fullName(hi)} is mentoring ${fullName(lo)}.`, 1, [hi.id, lo.id]);
  }
}

function addAffair(ctx: Ctx, a: Person, b: Person): void {
  for (const [x, y] of [[a, b], [b, a]] as const) {
    x.secrets.push({
      id: newId(ctx.s, 'sec'),
      kind: 'affair',
      description: `Is in an undisclosed relationship with ${fullName(y)} across the reporting line.`,
      severity: 2,
      revealed: false,
      involvedIds: [y.id],
    });
  }
}

// ------------------------------------------------------------- scheming

function traitMult(p: Person): number {
  let m = 1;
  if (has(p, 'ruthless')) m *= 1.5;
  if (has(p, 'paranoid')) m *= 1.2;
  if (has(p, 'reckless')) m *= 1.2;
  if (has(p, 'principled')) m *= 0.3;
  if (has(p, 'lazy')) m *= 0.7;
  if (has(p, 'cautious')) m *= 0.8;
  return m;
}

function scheme(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  if (p.involvement < T.schemeMinInvolvement || p.ambition < T.schemeMinAmbition) return;
  const chancePerMonth = T.schemeBase * (p.involvement / 100) * (p.ambition / 100) * (0.6 + p.skills.guile / 100) * traitMult(p);
  if (!chance(s, chancePerMonth)) return;
  const canEmbezzle = p.greed >= 60 && p.skills.guile >= 50 && isManager(p) && !p.secrets.some((x) => x.kind === 'embezzlement');
  const act = weightedPick(s, ['credit', 'undermine', 'court', 'clique', 'leak', 'embezzle'] as const, (a) =>
    a === 'credit' ? 3 : a === 'undermine' ? 3 : a === 'court' ? 3 : a === 'clique' ? 2 : a === 'leak' ? T.leakWeight * (1 + (60 - p.loyalty) / 60) : canEmbezzle ? 2 : 0,
  );
  if (act === 'credit') takeCredit(ctx, p);
  else if (act === 'undermine') undermine(ctx, p);
  else if (act === 'court') court(ctx, p);
  else if (act === 'clique') cliqueWork(ctx, p);
  else if (act === 'leak') leak(ctx, p);
  else embezzle(ctx, p);
}

function takeCredit(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  const boss = bossOf(s, p.id);
  const t = randomMate(s, p);
  if (!boss || !t || t.id === boss) return;
  const blame = chance(s, 0.4);
  adjustOpinion(s, boss, p.id, blame ? 1 : 3);
  adjustOpinion(s, boss, t.id, blame ? -4 : -3);
  adjustOpinion(s, t.id, p.id, -5);
  if (isManager(p)) addLog(s, `${fullName(p)} ${blame ? 'shifted blame onto' : 'took credit for work by'} ${fullName(t)}.`, 1, [p.id, t.id]);
}

function undermine(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  let t: Person | undefined;
  for (const [oid, rel] of Object.entries(s.relations[p.id] ?? {})) {
    if (rel.tag === 'rival' && isStaff(s.people[oid])) {
      t = s.people[oid];
      break;
    }
  }
  t ??= pickAssociate(ctx, p) ?? undefined;
  if (!t || t.id === p.id || !isStaff(t)) return;
  t.satisfaction = clamp(t.satisfaction - 3);
  const tb = bossOf(s, t.id);
  if (tb && tb !== p.id) adjustOpinion(s, tb, t.id, -3);
  adjustOpinion(s, t.id, p.id, -6);
  const rel = getRelation(s, p.id, t.id);
  if (rel && !rel.tag && rel.opinion < -30) {
    setTag(s, p.id, t.id, 'rival');
    setTag(s, t.id, p.id, 'rival');
  }
  if (isManager(p) || isManager(t)) addLog(s, `${fullName(p)} is working against ${fullName(t)}.`, 1, [p.id, t.id]);
}

function court(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  const gain = 2 + p.skills.guile / 40;
  if (rank(p) >= 6) {
    const dirs = s.directors.map((d) => s.people[d.personId]).filter((d) => d && isActive(d));
    if (dirs.length) {
      adjustOpinion(s, pick(s, dirs).id, p.id, gain);
      return;
    }
  }
  const chain = chainOfCommand(s, p.id);
  const up = chain[1] ?? chain[0];
  if (up) adjustOpinion(s, up, p.id, gain);
}

function cliqueWork(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  const friends = Object.entries(s.relations[p.id] ?? {})
    .filter(([oid, r]) => r.opinion >= 25 && isStaff(s.people[oid]) && !s.people[oid].cliqueId && oid !== p.id)
    .map(([oid]) => s.people[oid]);
  const own = clique(s, p.cliqueId);
  if (own) {
    if (friends.length && own.memberIds.length < 8) {
      const f = pick(s, friends);
      f.cliqueId = own.id;
      own.memberIds.push(f.id);
    }
    return;
  }
  if (!friends.length || Object.keys(s.cliques).length >= T.maxCliques) return;
  const members = friends.slice(0, randInt(s, 1, 2));
  const id = newId(s, 'cl');
  const c: NpcCliqueData = {
    id,
    name: `The ${pick(s, CLIQUE_A)} ${pick(s, CLIQUE_B)}`,
    leaderId: p.id,
    memberIds: [p.id, ...members.map((m) => m.id)],
    agenda: pick(s, CLIQUE_AGENDAS),
    known: false,
    momentum: 0,
  };
  s.cliques[id] = c;
  for (const id2 of c.memberIds) person(s, id2).cliqueId = id;
  addLog(s, `${fullName(p)} has gathered a clique.`, 1, c.memberIds);
  raise(ctx, 'cliqueFormed', p, c.memberIds, { cliqueId: id }, c.memberIds.length >= 3 ? 1 : 0);
}

function leak(ctx: Ctx, p: Person): void {
  addLog(ctx.s, `${fullName(p)} passed internal material to an outside party.`, 2, [p.id]);
  addLifeEvent(ctx.s, p.id, 'leak', 'Leaked internal material to an outside party.', 0, false);
  raise(ctx, 'leak', p, [p.id], { description: `${fullName(p)} is suspected of passing internal material to a rival corporation.` });
}

function embezzle(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  const sec: Secret = {
    id: newId(s, 'sec'),
    kind: 'embezzlement',
    description: `Has been skimming from ${pronoun(p, 'possessive')} unit's discretionary funds.`,
    severity: chance(s, 0.3) ? 3 : 2,
    revealed: false,
    involvedIds: [],
  };
  p.secrets.push(sec);
  s.company.cash -= randInt(s, 5_000, 40_000);
}

function discoverEmbezzlement(ctx: Ctx, p: Person): void {
  const sec = p.secrets.find((x) => x.kind === 'embezzlement' && !x.revealed);
  if (!sec || !chance(ctx.s, T.embezzleDiscoverChance)) return;
  sec.revealed = true;
  addLifeEvent(ctx.s, p.id, 'scandal', 'Caught skimming funds.', -8, false);
  addLog(ctx.s, `Audit flags missing funds in ${fullName(p)}'s unit.`, 2, [p.id]);
  raise(ctx, 'embezzlement', p, [p.id], { secretId: sec.id });
}

// ------------------------------------------------------------- plotting

const plotsOf = (s: NpcState): Record<PersonId, Plot> => (s.npcPlots ??= {});

function maybeStartPlot(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  if (p.ambition < T.plotMinAmbition || p.involvement < T.plotMinInvolvement || plotsOf(s)[p.id]) return;
  const bossId = bossOf(s, p.id);
  if (!bossId) return;
  const resentment = -opinionOf(s, p.id, bossId) + (50 - p.loyalty) * 0.5 + (55 - p.satisfaction) * 0.3;
  if (resentment <= 0) return;
  const c = T.plotBase * (p.ambition / 100) * (p.involvement / 100) * (resentment / 30) * (0.6 + p.skills.guile / 100) * traitMult(p);
  if (!chance(s, c)) return;
  plotsOf(s)[p.id] = { targetId: bossId, progress: 0, stage: 0 };
  if (!clique(s, p.cliqueId) && Object.keys(s.cliques).length < T.maxCliques) cliqueWork(ctx, p);
}

function runPlots(ctx: Ctx): void {
  const s = ctx.s;
  const plots = plotsOf(s);
  for (const [pid, plot] of Object.entries(plots)) {
    const p = s.people[pid];
    const t = s.people[plot.targetId];
    if (!isStaff(p) || !t || !isActive(t) || bossOf(s, pid) !== plot.targetId) {
      delete plots[pid];
      continue;
    }
    const cl = clique(s, p.cliqueId);
    const supporters = cl ? cl.memberIds.filter((m) => m !== pid && isStaff(s.people[m])) : [];
    plot.progress = Math.min(100, plot.progress + (T.plotGain + p.skills.guile / 25 + supporters.length * 1.2) * (0.5 + random(s)));

    if (t.role === 'ceo') {
      // Officers work on directors against the CEO.
      const dirs = s.directors.map((d) => s.people[d.personId]).filter((d) => d && isActive(d));
      for (let i = 0; i < Math.min(2, dirs.length); i++) {
        const d = pick(s, dirs);
        adjustOpinion(s, d.id, t.id, -1.5);
        adjustOpinion(s, d.id, p.id, 1.5);
      }
    } else {
      const tb = bossOf(s, t.id);
      if (tb) {
        adjustOpinion(s, tb, t.id, -1.2);
        adjustOpinion(s, tb, p.id, 1);
      }
      for (const m of supporters) adjustOpinion(s, m, t.id, -0.8);
    }

    const target = rank(t) >= 8 ? 8 : 0;
    const caught = T.plotCaughtChance + (has(t, 'paranoid') ? 0.02 : 0) + t.skills.guile / 3000;
    if (t.role !== 'ceo' && chance(s, caught)) {
      adjustOpinion(s, t.id, p.id, -35);
      setTag(s, t.id, p.id, 'grudge');
      adjustOpinion(s, p.id, t.id, -10);
      addLifeEvent(s, p.id, 'plotExposed', `${fullName(t)} found out about ${pronoun(p, 'possessive')} campaign.`, -4, false);
      addLog(s, `${fullName(p)}'s campaign against ${fullName(t)} was exposed.`, 2, [p.id, t.id]);
      raise(ctx, 'scheme', p, [p.id, t.id], { targetId: t.id, exposed: true }, target);
      delete plots[pid];
      continue;
    }

    const stages = T.plotStages;
    if (plot.stage < stages.length && plot.progress >= stages[plot.stage]) {
      plot.stage++;
      if (chance(s, T.plotNoticeChance)) raise(ctx, 'scheme', p, [p.id, t.id], { targetId: t.id, progress: Math.round(plot.progress) }, target + (t.role === 'ceo' ? 8 : 0));
    }
    if (plot.progress >= 100) concludePlot(ctx, p, t, plots);
  }
}

function concludePlot(ctx: Ctx, p: Person, t: Person, plots: Record<PersonId, Plot>): void {
  const s = ctx.s;
  const tu = t.unitId ? unit(s, t.unitId) : null;
  const seatLevel = t.role === 'teamLead' || t.role === 'subteamLead' || t.role === 'subdivisionHead';
  if (!seatLevel || !tu || tu.leadId !== t.id) {
    // Higher seats are the player's to rule on; keep pressing.
    if (chance(ctx.s, 0.3)) raise(ctx, 'scheme', p, [p.id, t.id], { targetId: t.id, progress: 100, ripe: true }, t.role === 'ceo' ? 12 : 6);
    return;
  }
  const tb = bossOf(s, t.id);
  if (!tb || opinionOf(s, tb, p.id) < opinionOf(s, tb, t.id)) {
    plots[p.id].progress = 60; // the boss isn't convinced yet
    return;
  }
  leave(ctx, t, 'fired', `Pushed out of ${tu.name} after a quiet campaign by ${fullName(p)}.`);
  addLifeEvent(s, t.id, 'fired', `Removed as lead of ${tu.name}.`, -8, false);
  setLead(s, tu.id, p.id);
  p.title = titleFor(p.role, tu);
  addLifeEvent(s, p.id, 'promoted', `Took over ${tu.name} after unseating ${fullName(t)}.`, 8, false);
  addLog(s, `${fullName(p)} replaced ${fullName(t)} as head of ${tu.name}.`, 2, [p.id, t.id]);
  delete plots[p.id];
}

// ---------------------------------------------------------- managers

function isProtector(s: GameState, m: Person, w: Person): boolean {
  const fwd = getRelation(s, m.id, w.id);
  const back = getRelation(s, w.id, m.id);
  const strong = (t: RelTag | null | undefined) => t === 'mentor' || t === 'protege' || t === 'lover' || t === 'friend';
  return !!((fwd && (fwd.opinion >= T.protectOpinion || strong(fwd.tag))) || (back && strong(back.tag)));
}

function reviewPerformance(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  if (p.performance >= T.firePerformance || tenure(ctx, p) < T.fireMinTenure) return;
  if (rank(p) >= 6) return; // division heads and officers are the player's call
  const mgrId = bossOf(s, p.id);
  if (!mgrId) return;
  const mgr = person(s, mgrId);
  if (mgr.role === 'ceo') return;
  if (recent(ctx, p, 'protected', 6)) return;

  const warned = lastEvent(p, 'warned');
  if (!warned || s.month - warned.month > 12) {
    if (chance(s, T.warnChance)) addLifeEvent(s, p.id, 'warned', `Warned by ${fullName(mgr)} over poor performance.`, -2, false);
    return;
  }
  if (s.month - warned.month < 2) return;
  const c = T.fireChance * (has(mgr, 'ruthless') ? 1.5 : 1) * (has(mgr, 'generous') ? 0.5 : 1);
  if (!chance(s, c)) return;

  // A strong tie to anyone higher up the chain shields the worker.
  let protector: Person | null = null;
  for (const id of chainOfCommand(s, p.id)) {
    const m = person(s, id);
    if (m.role === 'ceo') continue;
    if (isProtector(s, m, p) && (!protector || opinionOf(s, m.id, p.id) > opinionOf(s, protector.id, p.id))) protector = m;
  }
  if (protector) return protect(ctx, p, mgr, protector);

  const interesting = isManager(p) || tenure(ctx, p) >= 48 || p.involvement >= 50 || chance(s, 0.1);
  leave(ctx, p, 'fired', 'Dismissed for sustained poor performance.');
  addLifeEvent(s, p.id, 'fired', `Dismissed by ${fullName(mgr)} for poor performance.`, -8, false);
  addLog(s, `${fullName(mgr)} dismissed ${fullName(p)} for poor performance.`, interesting ? 2 : 1, [mgr.id, p.id]);
  if (interesting) raise(ctx, 'managerFiring', mgr, [mgr.id, p.id], { action: 'fired' });
}

function protect(ctx: Ctx, p: Person, mgr: Person, protector: Person): void {
  const s = ctx.s;
  const skip = protector.id !== mgr.id;
  const dest = protector.unitId ? unit(s, protector.unitId) : null;
  const pull = skip && dest && p.unitId !== dest.id && dest.leadId === protector.id && chance(s, T.pullChance);
  if (pull && dest) {
    placeAsMember(s, p.id, dest.id);
    p.satisfaction = clamp(p.satisfaction + 5);
    adjustOpinion(s, mgr.id, protector.id, -4);
    addLifeEvent(s, p.id, 'transferred', `${fullName(protector)} brought ${pronoun(p, 'object')} into ${dest.name}.`, 3, false);
    addLog(s, `${fullName(protector)} pulled ${fullName(p)} into ${dest.name} rather than let ${fullName(mgr)} dismiss ${pronoun(p, 'object')}.`, 2, [protector.id, p.id, mgr.id]);
    return;
  }
  addLifeEvent(s, p.id, 'protected', `${fullName(protector)} shielded ${pronoun(p, 'object')} from dismissal.`, 2, false);
  if (skip) adjustOpinion(s, mgr.id, protector.id, -2);
  // Only actual dismissals go to the inbox (events.ts treats managerFiring as an appeal).
  if (skip && chance(s, 0.4)) {
    addLog(s, `${fullName(protector)} blocked the dismissal of ${fullName(p)}.`, 2, [protector.id, p.id, mgr.id]);
  }
}

function candidateScore(s: GameState, promoter: Person, c: Person): number {
  let v = c.performance * 0.45 + c.skills.management * 0.2 + opinionOf(s, promoter.id, c.id) * 0.6;
  if (promoter.cliqueId && promoter.cliqueId === c.cliqueId) v += 10;
  return v + gaussian(s) * 3;
}

function leadCandidates(s: GameState, u: OrgUnit): Person[] {
  const ids = [...u.memberIds];
  for (const cid of u.childIds) {
    const l = unit(s, cid).leadId;
    if (l) ids.push(l);
  }
  return ids.map((id) => s.people[id]).filter(isStaff).slice(0, 30);
}

function fillVacancies(ctx: Ctx): void {
  const s = ctx.s;
  for (const u of Object.values(s.units)) {
    if (u.leadId !== null || u.kind === 'executive') continue;
    if (u.kind === 'division' || u.kind === 'function') {
      demandSeat(ctx, u);
      continue;
    }
    const boss = managerOfUnit(s, u);
    if (!boss) continue;
    if (!chance(s, T.fillChance)) continue;
    const cands = leadCandidates(s, u).filter((c) => c.performance >= 30);
    if (!cands.length) {
      if (u.memberIds.length === 0 && u.childIds.length === 0) continue;
      if (chance(s, T.externalLeadChance)) hireLead(ctx, u, boss);
      continue;
    }
    const scored = cands.map((c) => ({ c, v: candidateScore(s, boss, c) }));
    scored.sort((a, b) => b.v - a.v);
    promote(ctx, u, boss, scored[0].c, cands);
  }
}

function promote(ctx: Ctx, u: OrgUnit, promoter: Person, winner: Person, cands: Person[]): void {
  const s = ctx.s;
  setLead(s, u.id, winner.id);
  winner.title = titleFor(winner.role, u);
  winner.salary = Math.max(winner.salary, roundPay(marketSalary(winner.role, quality(winner)) * 0.95));
  winner.satisfaction = clamp(winner.satisfaction + 10);
  addLifeEvent(s, winner.id, 'promoted', `Promoted to lead ${u.name}.`, 8, false);
  adjustOpinion(s, winner.id, promoter.id, 5);
  addLog(s, `${fullName(promoter)} promoted ${fullName(winner)} to lead ${u.name}.`, 1, [promoter.id, winner.id]);

  const wc = clique(s, winner.cliqueId);
  if (wc) wc.momentum = (wc.momentum ?? 0) + 1;
  for (const c of cands) {
    if (c.id === winner.id || c.ambition < T.passedOverAmbition || c.performance < 40 || !isActive(c)) continue;
    adjustOpinion(s, c.id, promoter.id, -6 * (c.ambition / 100) - 2);
    adjustOpinion(s, c.id, winner.id, -5);
    c.satisfaction = clamp(c.satisfaction - 6);
    addLifeEvent(s, c.id, 'passedOver', `Passed over for the lead of ${u.name}.`, -4, false);
    if (winner.ambition >= 50 && !getRelation(s, c.id, winner.id)?.tag && chance(s, 0.4)) {
      setTag(s, c.id, winner.id, 'rival');
      setTag(s, winner.id, c.id, 'rival');
      adjustOpinion(s, winner.id, c.id, -5);
    }
    const cc = clique(s, c.cliqueId);
    if (cc && cc.id !== winner.cliqueId) cc.momentum = (cc.momentum ?? 0) - 0.5;
  }
}

function hireLead(ctx: Ctx, u: OrgUnit, boss: Person): void {
  const s = ctx.s;
  const role: Role = u.kind === 'team' ? 'teamLead' : u.kind === 'subteam' ? 'subteamLead' : 'subdivisionHead';
  const q = clamp(50 + (boss.skills.management - 50) * 0.3, 25, 85);
  const p = createPerson(s, { role, quality: q });
  p.hiredMonth = s.month;
  setLead(s, u.id, p.id);
  p.title = titleFor(role, u);
  addLifeEvent(s, p.id, 'hired', `Hired from outside to lead ${u.name}.`, 3, false);
  addLog(s, `${fullName(boss)} brought in ${fullName(p)} from outside to lead ${u.name}.`, 1, [boss.id, p.id]);
}

/** Division head and officer seats are the player's call; the best insider asks for one. */
function demandSeat(ctx: Ctx, u: OrgUnit): void {
  const s = ctx.s;
  if (!chance(s, T.seatDemandChance)) return;
  const cands = peopleUnder(s, u.id)
    .map((id) => s.people[id])
    .filter((c) => isStaff(c) && c.performance >= 40 && !recent(ctx, c, 'seatDemand', 2));
  if (!cands.length) return;
  const score = (c: Person) => c.performance * 0.5 + c.skills.management * 0.3 + c.ambition * 0.2 + rank(c) * 3;
  const best = cands.reduce((a, b) => (score(b) > score(a) ? b : a));
  raise(ctx, 'promotionDemand', best, [best.id], { vacantUnitId: u.id }, 8, () =>
    addLifeEvent(s, best.id, 'seatDemand', `Asked for the lead of ${u.name}.`, 0, false),
  );
}

function hireToSize(ctx: Ctx): void {
  const s = ctx.s;
  const sizes = (s.npcUnitSizes ??= {});
  for (const u of Object.values(s.units)) {
    const want = sizes[u.id];
    if (want === undefined || u.memberIds.length > want) {
      sizes[u.id] = u.memberIds.length;
      continue;
    }
    if (u.memberIds.length >= want || u.kind === 'executive' || !chance(s, T.hireChance)) continue;
    const mgr = managerOfUnit(s, u);
    if (!mgr || u.budget <= 0 || s.company.cash <= 0) continue;
    const q = clamp(48 + (mgr.skills.management - 50) * 0.35, 25, 85);
    const p = createPerson(s, { role: 'worker', quality: q });
    p.salary = roundPay(marketSalary('worker', p.skills.work));
    p.hiredMonth = s.month;
    placeAsMember(s, p.id, u.id);
    if (!p.title || p.title === 'worker') p.title = titleFor('worker', u);
    addLifeEvent(s, p.id, 'hired', `Hired into ${u.name} by ${fullName(mgr)}.`, 3, false);
    addLog(s, `${fullName(mgr)} hired ${fullName(p)} into ${u.name}.`, 1, [mgr.id, p.id]);
  }
}

function giveRaises(ctx: Ctx): void {
  const s = ctx.s;
  for (const u of Object.values(s.units)) {
    if (!u.memberIds.length || u.budget <= 0 || !chance(s, T.raiseChance)) continue;
    const mgr = managerOfUnit(s, u);
    if (!mgr || mgr.role === 'ceo') continue;
    const c = s.people[pick(s, u.memberIds)];
    if (!isStaff(c) || c.performance < 65 || opinionOf(s, mgr.id, c.id) < -10) continue;
    const market = marketPay(ctx, c);
    if (c.salary >= market * 1.1 || (c.salary > market && c.satisfaction >= 60)) continue;
    const amount = Math.max(500, roundPay(c.salary * (0.03 + random(s) * 0.03)));
    if (amount / 12 > u.budget * 0.1) continue;
    c.salary += amount;
    c.satisfaction = clamp(c.satisfaction + 4);
    addLifeEvent(s, c.id, 'raise', `Given a raise by ${fullName(mgr)}.`, 2, false);
    adjustOpinion(s, c.id, mgr.id, 2);
  }
}

// ----------------------------------------------------------- requests

function requests(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  const lead = isManager(p);
  const ratio = p.salary / Math.max(1, marketPay(ctx, p));
  if (lead && ratio < 0.9 && p.ambition >= 45 && !recent(ctx, p, 'raiseAsked', 6) && chance(s, T.raiseDemandChance * (0.5 + p.greed / 100))) {
    const amount = roundPay(marketPay(ctx, p) - p.salary);
    raise(ctx, 'raiseDemand', p, [p.id], { amount, pct: amount / p.salary }, 0, () => addLifeEvent(s, p.id, 'raiseAsked', 'Asked for a raise.', 0, false));
  }
  if (!lead && p.ambition >= 65 && p.performance >= 65 && p.satisfaction < 55 && tenure(ctx, p) >= 24) {
    const promoted = lastEvent(p, 'promoted');
    const since = s.month - Math.max(p.hiredMonth, promoted?.month ?? -999);
    if (since >= 24 && !recent(ctx, p, 'promotionAsked', 8) && chance(s, T.promotionDemandChance)) {
      const seat = unitAncestryVacant(s, p);
      raise(ctx, 'promotionDemand', p, [p.id], seat ? { vacantUnitId: seat } : {}, 0, () =>
        addLifeEvent(s, p.id, 'promotionAsked', 'Asked to be considered for promotion.', 0, false),
      );
    }
  }
  const valuable = p.performance >= 60 || p.skills.work >= 65 || lead;
  if (valuable && p.satisfaction < 35 && !recent(ctx, p, 'resignThreat', 6) && chance(s, T.resignThreatChance)) {
    raise(ctx, 'resignationThreat', p, [p.id], {}, 0, () => addLifeEvent(s, p.id, 'resignThreat', 'Threatened to resign.', -1, false));
  }
  if (p.role === 'worker' && p.satisfaction < 45 && !recent(ctx, p, 'complained', 8)) {
    const bossId = bossOf(s, p.id);
    if (bossId && opinionOf(s, p.id, bossId) <= -40 && chance(s, T.complaintChance)) {
      raise(ctx, 'complaint', p, [p.id, bossId], {}, 0, () => addLifeEvent(s, p.id, 'complained', `Filed a complaint against ${fullName(person(s, bossId))}.`, -1, false));
    }
  }
}

/** A vacant lead seat somewhere above the person, if any. */
function unitAncestryVacant(s: GameState, p: Person): UnitId | null {
  let u: OrgUnit | null = unit(s, p.unitId!);
  while (u) {
    if (u.leadId === null && u.kind !== 'executive') return u.id;
    u = u.parentId ? unit(s, u.parentId) : null;
  }
  return null;
}

// ------------------------------------------------------------ leaving

function leaving(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  if (p.satisfaction >= T.quitSatisfaction || tenure(ctx, p) < 3) return;
  if (!chance(s, T.quitChance * (1 + (T.quitSatisfaction - p.satisfaction) / 20))) return;
  const valuable = p.performance >= 65 || p.skills.work >= 65 || isManager(p);
  const corp = pick(s, RIVAL_CORPS);
  if (valuable) {
    const offered = lastEvent(p, 'poachOffer');
    if (!offered || s.month - offered.month > 4) {
      const salary = roundPay(marketPay(ctx, p) * 1.25);
      raise(ctx, 'poachOffer', p, [p.id], { rivalCorp: corp, salary, offer: salary }, 0, () =>
        addLifeEvent(s, p.id, 'poachOffer', `Received an offer from ${corp}.`, 0, false),
      );
      return;
    }
    if (s.month - offered.month < 1) return;
    addLifeEvent(s, p.id, 'defected', `Left for ${corp}.`, -2, false);
    addLog(s, `${fullName(p)} left the company for ${corp}.`, rank(p) >= 4 ? 3 : 2, [p.id]);
    leave(ctx, p, 'defected', `Joined ${corp} on a better offer.`);
    return;
  }
  addLifeEvent(s, p.id, 'quit', 'Resigned.', -2, false);
  addLog(s, `${fullName(p)} resigned.`, rank(p) >= 3 ? 2 : 1, [p.id]);
  leave(ctx, p, 'quit', pick(s, QUIT_FATES));
}

// --------------------------------------------- breakthroughs, scandals

function breakthroughOrScandal(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  const diligent = has(p, 'diligent');
  if (p.skills.work >= 70 && p.performance >= 70 && chance(s, diligent ? T.breakthroughChance : T.breakthroughChance / 4)) {
    const description = pick(s, BREAKTHROUGHS);
    p.satisfaction = clamp(p.satisfaction + 10);
    unit(s, p.unitId!).morale = clamp(unit(s, p.unitId!).morale + 2);
    addLifeEvent(s, p.id, 'breakthrough', description, 6, false);
    addLog(s, `${fullName(p)}: ${description}`, 2, [p.id]);
    raise(ctx, 'breakthrough', p, [p.id], { description });
  }
  for (const sec of p.secrets) {
    if (sec.revealed || sec.kind === 'embezzlement') continue;
    if (!chance(s, T.scandalChance * sec.severity)) continue;
    sec.revealed = true;
    const others: PersonId[] = [];
    for (const id of sec.involvedIds) {
      const o = s.people[id];
      const match = o?.secrets.find((x) => x.kind === sec.kind && !x.revealed && x.involvedIds.includes(p.id));
      if (match) {
        match.revealed = true;
        others.push(id);
      }
    }
    p.satisfaction = clamp(p.satisfaction - 5);
    addLifeEvent(s, p.id, 'scandal', sec.description, -4 * sec.severity, false);
    addLog(s, `Scandal: ${fullName(p)}. ${sec.description}`, 3, [p.id, ...others]);
    raise(ctx, 'scandal', p, [p.id, ...others], { secretId: sec.id }, sec.severity);
    break;
  }
}

// ------------------------------------------------------------- upkeep

function cliqueUpkeep(s: NpcState): void {
  for (const c of Object.values(s.cliques) as NpcCliqueData[]) {
    c.memberIds = c.memberIds.filter((id) => isActive(person(s, id)));
    c.momentum = (c.momentum ?? 0) * 0.9;
    if (c.memberIds.length < 2) {
      for (const id of c.memberIds) person(s, id).cliqueId = null;
      delete s.cliques[c.id];
      continue;
    }
    if (!c.memberIds.includes(c.leaderId)) {
      c.leaderId = c.memberIds.reduce((a, b) => (person(s, b).involvement > person(s, a).involvement ? b : a));
    }
  }
}

/** Keeps the monthly inbox manageable: best incidents win, the rest stay silent. */
function flush(ctx: Ctx): void {
  const ranked = ctx.out.map((c) => ({ c, v: c.priority + random(ctx.s) * 3 })).sort((a, b) => b.v - a.v);
  for (const { c } of ranked.slice(0, T.maxIncidentsPerMonth)) {
    c.commit?.();
    ctx.s.incidents.push(c.incident);
  }
}

export function runNpcMonth(state: GameState): void {
  const ctx: Ctx = { s: state as NpcState, out: [], pay: new Map() };
  const s = ctx.s;
  const live = (p: Person) => isStaff(p);
  const staff = activeStaff(s).filter(live);

  for (const p of staff) updateSatisfaction(ctx, p);
  for (const p of staff) if (live(p)) tendRelations(ctx, p);
  for (const p of staff) if (live(p)) formRelation(ctx, p);
  for (const p of staff) {
    if (!live(p)) continue;
    scheme(ctx, p);
    maybeStartPlot(ctx, p);
    discoverEmbezzlement(ctx, p);
  }
  runPlots(ctx);
  for (const p of staff) if (live(p)) reviewPerformance(ctx, p);
  fillVacancies(ctx);
  hireToSize(ctx);
  giveRaises(ctx);
  for (const p of staff) if (live(p)) requests(ctx, p);
  for (const p of staff) if (live(p)) leaving(ctx, p);
  for (const p of staff) if (live(p)) breakthroughOrScandal(ctx, p);
  cliqueUpkeep(s);
  flush(ctx);
}
