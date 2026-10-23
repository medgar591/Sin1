// Everything the player can do on their turn. Each action checks and spends
// attention, applies the skip-level penalty when the player goes around the
// people who should handle it, records life events, and returns a result.
import type {
  ActionResult,
  FunctionKind,
  GameState,
  LifeEvent,
  OrgUnit,
  Person,
  PersonId,
  PromiseKind,
  Role,
  UnitId,
  UnitKind,
} from './types';
import { createPerson, marketSalary } from './generate';
import { endGame } from './epilogue';
import {
  activeStaff,
  addLifeEvent,
  addLog,
  adjustLoyalty,
  adjustOpinion,
  chainOfCommand,
  bossOf,
  clamp,
  formatZuzu,
  fullName,
  hasAttention,
  isLead,
  newId,
  peopleUnder,
  person,
  placeAsMember,
  pronoun,
  removeFromCompany,
  roleForUnitKind,
  setLead,
  unit,
  unitsUnder,
} from './org';
import { chance, pick, randInt } from './rng';
import { setbackPlot } from './npc';

export const ATTENTION_COST = {
  hire: 1,
  fire: 1,
  promote: 1,
  demote: 1,
  reassign: 1,
  setSalary: 0,
  grantOptions: 0,
  setBudget: 0,
  restructure: 1,
  meet: 1,
  investigatePerson: 1,
  investigateUnit: 1,
  lobbyDirector: 1,
  fixer: 1,
  setGuidance: 0,
  allocateBonus: 0,
} as const;

// ---- Tuning ----
/** Loyalty lost by the immediate boss when the player goes around them. */
const SKIP_BOSS_PENALTY = 8;
/** Loyalty lost by the other managers in between. */
const SKIP_OTHER_PENALTY = 4;
/** Meetings sting half as much as personnel moves. */
const SKIP_MEETING_STRENGTH = 0.5;

const HIRE_TIERS = {
  cheap: { quality: 35, pay: 0.9, fee: 0 },
  standard: { quality: 50, pay: 1, fee: 0 },
  premium: { quality: 68, pay: 1.12, fee: 0.25 },
} as const;
export type HireTier = keyof typeof HIRE_TIERS;
const HIRE_NOISE = 5;
const HIRE_LOYALTY_BONUS = 10;

const SEVERANCE_BASE_MONTHS = 2;
const SEVERANCE_MAX_MONTHS = 12;
const PROTECTOR_ANGER = 14;
const TIE_WEIGHT = { lover: 0.6, mentor: 0.7, protege: 0.7, friend: 0.5, clique: 0.3, fan: 0.3 } as const;
const RIVAL_REACTION = 0.3;

const PROMOTION_RAISE_MIN = 12;
const PROMOTION_RAISE_MAX = 20;
const DEMOTION_PAY_CUT = 0.1;
const PASSED_OVER_AMBITION = 55;

const BONUS_HIGH_PERFORMER = 70;
const BONUS_WEIGHT = { officer: 3, divisionHead: 2.5, other: 1 } as const;
const OPTION_GRANT_MAX_FRACTION = 0.005;

const PROMISE_LOYALTY = 10;
const PROMISE_OPINION = 6;
const PROMISE_MAX_MONTHS = 24;
const RAISE_PROMISE_FRACTION = 0.1;
const BROKEN_LOYALTY = 20;
const BROKEN_OPINION = 25;
const BROKEN_FRIEND_OPINION = 6;
const KEPT_LOYALTY = 6;
const KEPT_OPINION = 8;

/** Firing an officer takes the CEO's full attention and the board notices. */
const OFFICER_FIRE_ATTENTION = 2;
const OFFICER_FIRE_CONFIDENCE = 3;
/** Opinion lost with each director who was close to the fired officer (scaled by how close). */
const OFFICER_FIRE_ALLY_OPINION = 10;
const ALLY_CLOSE = 25;
/** Firing someone Security has already caught out costs the board only this share. */
const FOR_CAUSE_SHARE = 0.4;
/** A private threat knocks this much off a plotter's campaign. */
const THREAT_PLOT_SETBACK = 15;

const FAVOR_COST = 150_000;
const FAVOR_SWING = 12;
const PRESSURE_BACKFIRE = -20;

const ROLE_RANK: Record<Role, number> = {
  ceo: 9, chair: 8, director: 8, officer: 5, divisionHead: 4,
  subdivisionHead: 3, teamLead: 2, subteamLead: 1, worker: 0,
};

const FUNCTION_TITLES: Record<FunctionKind, string> = {
  operations: 'Chief Operating Officer',
  finance: 'Chief Financial Officer',
  security: 'Head of Security',
  personnel: 'Head of Personnel',
  legal: 'General Counsel',
};

// ---- Shared helpers ----

const fail = (message: string): ActionResult => ({ ok: false, message });
const ok = (message: string): ActionResult => ({ ok: true, message });
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function precheck(state: GameState, cost: number): ActionResult | null {
  if (state.gameOver) return fail('The game is over.');
  if (state.player.attentionLeft < cost) return fail('No attention left this month.');
  return null;
}

const spend = (state: GameState, cost: number) => {
  state.player.attentionLeft -= cost;
};

const isDirector = (state: GameState, p: Person) =>
  p.role === 'chair' || p.role === 'director' || state.directors.some((d) => d.personId === p.id);

/** A staff member the player may act on: active, in the tree, not the player, not on the board. */
function staffTarget(state: GameState, id: PersonId): Person | ActionResult {
  const p = state.people[id];
  if (!p || p.status !== 'active') return fail('That person is no longer with the company.');
  if (id === state.player.personId) return fail("You can't do that to yourself.");
  if (isDirector(state, p)) return fail('Directors answer to the board, not to you.');
  if (p.unitId === null) return fail('That person has no post in the company.');
  return p;
}
const isFail = (x: Person | ActionResult): x is ActionResult => 'ok' in x;

export function seatTitle(u: OrgUnit): string {
  switch (u.kind) {
    case 'executive': return 'Chief Executive Officer';
    case 'function': return (u.functionKind && FUNCTION_TITLES[u.functionKind]) || `Head of ${u.name}`;
    case 'division':
    case 'subdivision': return `Head of ${u.name}`;
    case 'team': return `Team Lead, ${u.name}`;
    case 'subteam': return `Sub-team Lead, ${u.name}`;
  }
}
const memberTitle = (u: OrgUnit) => `Staff, ${u.name}`;

function teamName(u: OrgUnit): string {
  return u.name;
}

/** Leads from this unit (or its parent) up to the root, excluding the player; immediate boss first. */
function leadsFromUnit(state: GameState, unitId: UnitId, includeOwn: boolean): PersonId[] {
  const out: PersonId[] = [];
  let u: OrgUnit | null = includeOwn ? unit(state, unitId) : unit(state, unitId).parentId ? unit(state, unit(state, unitId).parentId!) : null;
  while (u) {
    if (u.leadId && u.leadId !== state.player.personId && !out.includes(u.leadId)) out.push(u.leadId);
    u = u.parentId ? unit(state, u.parentId) : null;
  }
  return out;
}

/** Who the player goes around by acting directly on this person. */
export interface SkipLevelInfo {
  /** Managers between the player's direct report and the target who get bypassed. */
  bypassed: PersonId[];
  /** Loyalty each bypassed manager would lose. 0 if waived or not skipping. */
  penalty: number;
  /** Loyalty lost by each bypassed manager, aligned with `bypassed` (the immediate boss takes the big hit). */
  penalties: number[];
  /** True if the target currently has the player's attention (scandal, breakthrough). */
  waived: boolean;
}

export function skipLevelInfo(state: GameState, targetId: PersonId): SkipLevelInfo {
  const t = person(state, targetId);
  const bypassed = t.status === 'active' ? chainOfCommand(state, targetId).filter((id) => id !== state.player.personId) : [];
  const waived = hasAttention(state, t);
  const penalties = bypassed.map((_, i) => (waived ? 0 : i === 0 ? SKIP_BOSS_PENALTY : SKIP_OTHER_PENALTY));
  return { bypassed, penalty: Math.max(0, ...penalties), penalties, waived };
}

/**
 * Charges the skip-level penalty. Each group lists managers immediate boss
 * first; the first of each group takes the big hit. Returns a message suffix.
 */
function applySkip(state: GameState, groups: PersonId[][], targetId: PersonId | null, strength = 1): string {
  if (targetId && hasAttention(state, person(state, targetId))) return '';
  const weights = new Map<PersonId, number>();
  for (const g of groups) {
    g.forEach((id, i) => {
      if (id === state.player.personId || id === targetId) return;
      const w = i === 0 ? SKIP_BOSS_PENALTY : SKIP_OTHER_PENALTY;
      weights.set(id, Math.max(weights.get(id) ?? 0, w));
    });
  }
  const names: string[] = [];
  let lastObj = 'them';
  for (const [id, w] of weights) {
    const m = state.people[id];
    if (!m || m.status !== 'active') continue;
    adjustLoyalty(state, id, -Math.round(w * strength));
    adjustOpinion(state, id, state.player.personId, -Math.round((w * strength) / 2));
    names.push(m.lastName);
    lastObj = pronoun(m, 'object');
  }
  if (names.length === 0) return '';
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return ` ${who} will remember you went around ${names.length === 1 ? lastObj : 'them'}.`;
}

/** Tie strength between `x` and the target (positive: x cares about them). */
function tieWeight(state: GameState, x: PersonId, targetId: PersonId): number {
  const rel = state.relations[x]?.[targetId];
  const t = person(state, targetId);
  const mate = t.cliqueId !== null && person(state, x).cliqueId === t.cliqueId;
  if (rel?.tag === 'lover') return TIE_WEIGHT.lover;
  if (rel?.tag === 'protege' || rel?.tag === 'mentor') return TIE_WEIGHT.mentor;
  if (state.relations[targetId]?.[x]?.tag === 'protege' || state.relations[targetId]?.[x]?.tag === 'mentor') return TIE_WEIGHT.mentor;
  if (rel?.tag === 'friend') return TIE_WEIGHT.friend;
  if (rel?.tag === 'rival' || rel?.tag === 'grudge') return -RIVAL_REACTION;
  if (mate) return TIE_WEIGHT.clique;
  if (rel && rel.opinion >= 50) return TIE_WEIGHT.fan;
  return 0;
}

/** Friends, lovers, protégés/mentors and clique-mates of the target react to what happened to them. */
function ripple(state: GameState, targetId: PersonId, opinionDelta: number, loyaltyDelta = 0): void {
  const t = person(state, targetId);
  const candidates = new Set<PersonId>(Object.keys(state.relations).filter((x) => state.relations[x][targetId]));
  for (const x of Object.keys(state.relations[targetId] ?? {})) candidates.add(x);
  if (t.cliqueId && state.cliques[t.cliqueId]) for (const x of state.cliques[t.cliqueId].memberIds) candidates.add(x);
  for (const x of candidates) {
    const m = state.people[x];
    if (!m || m.status !== 'active' || x === targetId || x === state.player.personId || isDirector(state, m)) continue;
    const w = tieWeight(state, x, targetId);
    if (w === 0) continue;
    const o = Math.round(opinionDelta * w);
    const l = Math.round(loyaltyDelta * w);
    if (o) adjustOpinion(state, x, state.player.personId, o);
    if (l) adjustLoyalty(state, x, l);
  }
}

/** People who sponsor the target: their mentor, or anyone whose protégé they are. */
function protectorsOf(state: GameState, targetId: PersonId): PersonId[] {
  const out = new Set<PersonId>();
  for (const [x, row] of Object.entries(state.relations)) if (row[targetId]?.tag === 'protege') out.add(x);
  for (const [x, rel] of Object.entries(state.relations[targetId] ?? {})) if (rel.tag === 'mentor') out.add(x);
  return [...out].filter((x) => {
    const m = state.people[x];
    return m && m.status === 'active' && x !== state.player.personId && !isDirector(state, m);
  });
}

/** Ambitious members of a unit resent a lead appointed over them. */
function resentPassedOver(state: GameState, u: OrgUnit, except: PersonId[]): void {
  for (const id of u.memberIds.slice()) {
    const m = state.people[id];
    if (!m || m.status !== 'active' || except.includes(id) || m.ambition < PASSED_OVER_AMBITION) continue;
    adjustOpinion(state, id, state.player.personId, -(2 + Math.round(m.ambition / 25)));
    m.satisfaction = clamp(m.satisfaction - 4);
    addLifeEvent(state, id, 'passedOver', `Passed over for the lead of ${teamName(u)}.`, -2, true);
  }
}

// ---- Hiring and firing ----

/** Hires a new person into a unit, as its lead (if the seat is empty) or as a member. */
export function hire(state: GameState, unitId: UnitId, asLead: boolean, tier: HireTier): ActionResult {
  const pre = precheck(state, ATTENTION_COST.hire);
  if (pre) return pre;
  const u = state.units[unitId];
  if (!u) return fail('No such unit.');
  const cfg = HIRE_TIERS[tier];
  if (!cfg) return fail('Unknown hiring tier.');
  if (asLead && u.leadId) return fail(`${u.name} already has a lead.`);

  const role: Role = asLead ? roleForUnitKind[u.kind] : 'worker';
  const quality = clamp(cfg.quality + randInt(state, -HIRE_NOISE, HIRE_NOISE), 15, 95);
  const salary = roundTo(marketSalary(role, quality, state.month) * cfg.pay, 500);
  const fee = Math.round(salary * cfg.fee);
  if (fee > state.company.cash) return fail(`The recruiter's fee (${formatZuzu(fee)}) is more than the company has on hand.`);

  const p = createPerson(state, { role, quality, salary });
  p.salary = salary;
  p.hiredMonth = state.month;
  p.loyalty = clamp(p.loyalty + HIRE_LOYALTY_BONUS);
  const groups = [leadsFromUnit(state, unitId, !asLead)];
  if (asLead) {
    setLead(state, unitId, p.id);
    p.title = seatTitle(u);
  } else {
    placeAsMember(state, p.id, unitId);
    if (!p.title) p.title = memberTitle(u);
  }
  adjustOpinion(state, p.id, state.player.personId, 10);
  state.company.cash -= fee;
  spend(state, ATTENTION_COST.hire);
  const skip = applySkip(state, groups, null);
  addLifeEvent(state, p.id, 'hired', `Hired as ${p.title} at ${formatZuzu(salary)} a year.`, 5, true);
  if (asLead) resentPassedOver(state, u, [p.id]);
  addLog(state, `Hired ${fullName(p)} as ${p.title}.`, asLead ? 2 : 1, [p.id]);
  return ok(`Hired ${fullName(p)} as ${p.title} at ${formatZuzu(salary)}${fee ? `, plus a ${formatZuzu(fee)} recruiter fee` : ''}.${skip}`);
}

/** Attention it takes to fire this person: officers cost more than anyone else. */
export function fireAttentionCost(state: GameState, personId: PersonId): number {
  return state.people[personId]?.role === 'officer' ? OFFICER_FIRE_ATTENTION : ATTENTION_COST.fire;
}

export function fire(state: GameState, personId: PersonId): ActionResult {
  const pre = precheck(state, ATTENTION_COST.fire);
  if (pre) return pre;
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  const cost = fireAttentionCost(state, personId);
  const pre2 = precheck(state, cost);
  if (pre2) return fail(`Firing ${fullName(p)} takes ${cost} attention.`);

  const groups = [chainOfCommand(state, personId)];
  const skip = applySkip(state, groups, personId);
  const protectors = protectorsOf(state, personId);
  const months = clamp(Math.round(SEVERANCE_BASE_MONTHS + (state.month - p.hiredMonth) / 12), SEVERANCE_BASE_MONTHS, SEVERANCE_MAX_MONTHS);
  const severance = Math.round((p.salary / 12) * months);
  state.company.cash -= severance;

  ripple(state, personId, -5, -2);
  for (const x of protectors) {
    adjustOpinion(state, x, state.player.personId, -PROTECTOR_ANGER);
    adjustLoyalty(state, x, -Math.round(PROTECTOR_ANGER / 2));
  }
  const title = p.title;
  addLifeEvent(state, personId, 'fired', `Fired from ${title}, with ${formatZuzu(severance)} severance.`, -8, true);
  removeFromCompany(state, personId, 'fired', `Fired by the CEO from ${title}; left with ${formatZuzu(severance)} severance.`);
  spend(state, cost);
  addLog(state, `Fired ${fullName(p)} (${title}).`, p.role === 'worker' ? 1 : 2, [personId]);
  let boardNote = '';
  if (p.role === 'officer') {
    // The board does not like watching the C-suite get purged without a reason.
    const cause = p.secrets.some((x) => x.revealed && x.severity >= 2);
    const k = cause ? FOR_CAUSE_SHARE : 1;
    state.company.boardConfidence = clamp(state.company.boardConfidence - OFFICER_FIRE_CONFIDENCE * k);
    let upset = 0;
    for (const d of state.directors) {
      const op = state.relations[d.personId]?.[personId]?.opinion ?? 0;
      if (op < ALLY_CLOSE || state.people[d.personId]?.status !== 'active') continue;
      adjustOpinion(state, d.personId, state.player.personId, -Math.round((OFFICER_FIRE_ALLY_OPINION * k * op) / 50));
      upset++;
    }
    boardNote = ` The board ${cause ? 'accepts the cause shown' : 'is unsettled'}${upset ? `; ${upset} director${upset === 1 ? '' : 's'} close to ${pronoun(p, 'object')} took it badly` : ''}.`;
  }
  const angry = protectors.length ? ` ${state.people[protectors[0]].lastName}, who backed ${pronoun(p, 'object')}, took it badly.` : '';
  return ok(`Fired ${fullName(p)}. Severance ${formatZuzu(severance)}.${angry}${boardNote}${skip}`);
}

// ---- Seats ----

/** Makes the person lead of the unit. A sitting lead is moved down to a member of it. */
export function promote(state: GameState, personId: PersonId, unitId: UnitId): ActionResult {
  const pre = precheck(state, ATTENTION_COST.promote);
  if (pre) return pre;
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  const u = state.units[unitId];
  if (!u) return fail('No such unit.');
  if (u.kind === 'executive') return fail('That seat is yours.');
  if (u.leadId === personId) return fail(`${fullName(p)} already leads ${u.name}.`);
  const newRole = roleForUnitKind[u.kind];
  if (ROLE_RANK[newRole] <= ROLE_RANK[p.role]) return fail(`That would not be a promotion for ${fullName(p)}.`);
  // Promoting someone into a unit above their own seat would leave them reporting to nobody sensible.
  if (p.unitId && p.unitId !== unitId && isLead(state, p) && unitsUnder(state, unitId).some((x) => x.id === p.unitId) && ROLE_RANK[newRole] <= ROLE_RANK[p.role]) {
    return fail('That promotion would create a loop in the chain of command.');
  }

  const groups = [chainOfCommand(state, personId), leadsFromUnit(state, unitId, false)];
  const skip = applySkip(state, groups, personId);
  const displaced = u.leadId ? person(state, u.leadId) : null;
  const wasLeadOf = isLead(state, p) ? unit(state, p.unitId!) : null;

  setLead(state, unitId, personId);
  p.title = seatTitle(u);
  const pct = randInt(state, PROMOTION_RAISE_MIN, PROMOTION_RAISE_MAX) / 100;
  p.salary = roundTo(p.salary * (1 + pct), 500);
  p.satisfaction = clamp(p.satisfaction + 10);
  adjustLoyalty(state, personId, 8);
  adjustOpinion(state, personId, state.player.personId, 10);
  addLifeEvent(state, personId, 'promoted', `Promoted to lead ${teamName(u)}; salary rose to ${formatZuzu(p.salary)}.`, 6, true);

  let note = '';
  if (displaced) {
    placeAsMember(state, displaced.id, unitId);
    displaced.title = memberTitle(u);
    displaced.satisfaction = clamp(displaced.satisfaction - 15);
    adjustLoyalty(state, displaced.id, -10);
    adjustOpinion(state, displaced.id, state.player.personId, -15);
    addLifeEvent(state, displaced.id, 'demoted', `Replaced as lead of ${teamName(u)} by ${fullName(p)} and kept on as staff.`, -5, true);
    ripple(state, displaced.id, -4, -2);
    note = ` ${displaced.lastName} stays on as staff and will resent it.`;
  }
  resentPassedOver(state, u, [personId, displaced?.id ?? '']);
  ripple(state, personId, 3);
  if (wasLeadOf) addLog(state, `${fullName(p)} left the lead of ${wasLeadOf.name} for ${u.name}; the seat is empty.`, 1, [personId]);
  spend(state, ATTENTION_COST.promote);
  addLog(state, `Promoted ${fullName(p)} to ${p.title}.`, 2, [personId]);
  return ok(`Promoted ${fullName(p)} to ${p.title}, salary ${formatZuzu(p.salary)}.${note}${skip}`);
}

/** Removes a lead from their seat, leaving them as a member of the same unit. */
export function demote(state: GameState, personId: PersonId): ActionResult {
  const pre = precheck(state, ATTENTION_COST.demote);
  if (pre) return pre;
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  if (!isLead(state, p)) return fail(`${fullName(p)} does not lead anything to be demoted from.`);

  const u = unit(state, p.unitId!);
  const skip = applySkip(state, [chainOfCommand(state, personId)], personId);
  const oldTitle = p.title;
  placeAsMember(state, personId, u.id);
  p.title = memberTitle(u);
  p.salary = roundTo(p.salary * (1 - DEMOTION_PAY_CUT), 500);
  p.satisfaction = clamp(p.satisfaction - 20);
  adjustLoyalty(state, personId, -15);
  adjustOpinion(state, personId, state.player.personId, -20);
  addLifeEvent(state, personId, 'demoted', `Demoted from ${oldTitle} to staff, with a pay cut.`, -5, true);
  ripple(state, personId, -4, -2);
  spend(state, ATTENTION_COST.demote);
  addLog(state, `Demoted ${fullName(p)} from ${oldTitle}.`, 2, [personId]);
  return ok(`Demoted ${fullName(p)} from ${oldTitle}. The seat is open.${skip}`);
}

/** Moves a non-lead person into another unit as a member. */
export function reassign(state: GameState, personId: PersonId, unitId: UnitId): ActionResult {
  const pre = precheck(state, ATTENTION_COST.reassign);
  if (pre) return pre;
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  const dest = state.units[unitId];
  if (!dest) return fail('No such unit.');
  if (isLead(state, p)) return fail(`${fullName(p)} leads a unit; demote or promote instead.`);
  if (dest.kind === 'executive') return fail('Not into your own office.');
  if (p.unitId === unitId) return fail(`${fullName(p)} is already in ${dest.name}.`);

  const from = unit(state, p.unitId!);
  const skip = applySkip(state, [chainOfCommand(state, personId), leadsFromUnit(state, unitId, true)], personId);
  const wasSeatTitle = p.title === memberTitle(from);
  placeAsMember(state, personId, unitId);
  if (wasSeatTitle) p.title = memberTitle(dest);
  const better = dest.morale >= from.morale;
  p.satisfaction = clamp(p.satisfaction + (better ? 2 : -3));
  addLifeEvent(state, personId, 'reassigned', `Moved from ${from.name} to ${dest.name}.`, better ? 1 : -1, true);
  spend(state, ATTENTION_COST.reassign);
  addLog(state, `Moved ${fullName(p)} from ${from.name} to ${dest.name}.`, 1, [personId]);
  return ok(`Moved ${fullName(p)} to ${dest.name}.${skip}`);
}

// ---- Pay ----

/** Peers who hear about someone's pay: gossips talk, and gossips listen. */
function grumbling(state: GameState, p: Person, headline: number): number {
  if (!p.unitId) return 0;
  const u = unit(state, p.unitId);
  const peers = [u.leadId, ...u.memberIds].filter((id): id is PersonId => !!id && id !== p.id);
  let n = 0;
  for (const id of peers) {
    const peer = state.people[id];
    if (!peer || peer.status !== 'active' || peer.role !== p.role) continue;
    if (!(p.traits.includes('gossip') || peer.traits.includes('gossip'))) continue;
    if (peer.salary >= headline) continue;
    peer.satisfaction = clamp(peer.satisfaction - 3);
    adjustOpinion(state, id, state.player.personId, -2);
    n++;
  }
  return n;
}

const greedFactor = (p: Person) => 0.5 + p.greed / 100;

export function setSalary(state: GameState, personId: PersonId, salary: number): ActionResult {
  const pre = precheck(state, ATTENTION_COST.setSalary);
  if (pre) return pre;
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  if (!Number.isFinite(salary) || salary <= 0) return fail('Salary must be a positive amount.');
  salary = Math.round(salary);
  if (salary === p.salary) return fail(`${fullName(p)} already earns that.`);

  const skip = applySkip(state, [chainOfCommand(state, personId)], personId);
  const old = p.salary;
  const pct = (salary - old) / old;
  const g = greedFactor(p);
  const sharpness = pct < 0 ? 1.5 : 1;
  p.salary = salary;
  p.satisfaction = clamp(p.satisfaction + clamp(pct * 100 * 0.8 * g * sharpness, -30, 30));
  adjustLoyalty(state, personId, Math.round(clamp(pct * 100 * 0.4 * g * sharpness, -15, 15)));
  adjustOpinion(state, personId, state.player.personId, Math.round(clamp(pct * 100 * 0.5 * g * sharpness, -20, 20)));
  if (pct > 0) {
    addLifeEvent(state, personId, 'raise', `Salary raised from ${formatZuzu(old)} to ${formatZuzu(salary)}.`, clamp(Math.round(pct * 20), 1, 4), true);
  } else {
    addLifeEvent(state, personId, 'payCut', `Salary cut from ${formatZuzu(old)} to ${formatZuzu(salary)}.`, -clamp(Math.round(-pct * 30), 2, 8), true);
  }
  const grumble = pct > 0.05 ? grumbling(state, p, salary) : 0;
  addLog(state, `Set ${fullName(p)}'s salary to ${formatZuzu(salary)}.`, 1, [personId]);
  return ok(`${fullName(p)} now earns ${formatZuzu(salary)} (${pct >= 0 ? '+' : ''}${Math.round(pct * 100)}%).${grumble ? ' Word got around the unit.' : ''}${skip}`);
}

export function grantOptions(state: GameState, personId: PersonId, shares: number): ActionResult {
  const pre = precheck(state, ATTENTION_COST.grantOptions);
  if (pre) return pre;
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  if (!Number.isFinite(shares) || shares <= 0) return fail('Grant a positive number of shares.');
  shares = Math.floor(shares);
  if (shares < 1) return fail('Grant at least one share.');
  if (shares > state.company.sharesOutstanding * OPTION_GRANT_MAX_FRACTION) return fail('The board would never approve a grant that large.');

  const skip = applySkip(state, [chainOfCommand(state, personId)], personId);
  const value = shares * state.company.sharePrice;
  const ratio = value / Math.max(1, p.salary);
  const g = greedFactor(p);
  p.stockOptions += shares;
  p.satisfaction = clamp(p.satisfaction + clamp(ratio * 25 * g, 0, 25));
  adjustLoyalty(state, personId, Math.round(clamp(ratio * 12 * g, 0, 15)));
  adjustOpinion(state, personId, state.player.personId, Math.round(clamp(ratio * 10 * g, 0, 15)));
  addLifeEvent(state, personId, 'options', `Granted ${shares.toLocaleString('en-US')} stock options worth ${formatZuzu(value)}.`, clamp(Math.round(ratio * 6), 1, 4), true);
  const grumble = ratio > 0.3 ? grumbling(state, p, p.salary + value) : 0;
  addLog(state, `Granted ${fullName(p)} ${shares} stock options.`, 1, [personId]);
  return ok(`Granted ${fullName(p)} ${shares.toLocaleString('en-US')} options worth ${formatZuzu(value)}.${grumble ? ' Word got around the unit.' : ''}${skip}`);
}

/** Splits the quarter's bonus pool. Amounts in zuzu; unallocated money returns to cash. */
export function allocateBonus(state: GameState, allocations: Record<string, number>): ActionResult {
  const pre = precheck(state, ATTENTION_COST.allocateBonus);
  if (pre) return pre;
  const pool = state.company.bonusPool;
  if (!(pool > 0)) return fail('There is no bonus pool to split.');
  let total = 0;
  for (const [id, amount] of Object.entries(allocations)) {
    const p = state.people[id];
    if (!p || p.status !== 'active' || p.unitId === null) return fail('A bonus was assigned to someone who is not on staff.');
    if (id === state.player.personId) return fail('You cannot pay yourself from the pool.');
    if (!Number.isFinite(amount) || amount < 0) return fail('Bonus amounts must be zero or more.');
    total += amount;
  }
  if (total > pool + 0.5) return fail(`That is ${formatZuzu(total - pool)} more than the pool holds.`);

  // Who expects a share, and roughly how big.
  const weights = new Map<PersonId, number>();
  for (const p of activeStaff(state)) {
    if (p.id === state.player.personId) continue;
    if (p.role === 'officer') weights.set(p.id, BONUS_WEIGHT.officer);
    else if (p.role === 'divisionHead') weights.set(p.id, BONUS_WEIGHT.divisionHead);
    else if (p.performance >= BONUS_HIGH_PERFORMER) weights.set(p.id, BONUS_WEIGHT.other);
  }
  const weightSum = [...weights.values()].reduce((a, b) => a + b, 0);
  let snubbed = 0;
  for (const [id, w] of weights) {
    const p = person(state, id);
    const fair = (pool * w) / weightSum;
    const got = allocations[id] ?? 0;
    const ratio = got / fair;
    if (ratio >= 1) {
      p.satisfaction = clamp(p.satisfaction + 3);
      adjustLoyalty(state, id, 1);
    } else if (ratio < 0.5) {
      const sting = (1 - ratio) * greedFactor(p);
      p.satisfaction = clamp(p.satisfaction - Math.round(6 * sting));
      adjustLoyalty(state, id, -Math.round(4 * sting));
      adjustOpinion(state, id, state.player.personId, -Math.round(6 * sting));
      if (ratio < 0.25) {
        addLifeEvent(state, id, 'bonusSnub', 'Got almost nothing from the bonus pool.', -1, true);
        snubbed++;
      }
    }
  }
  for (const [id, amount] of Object.entries(allocations)) {
    if (amount <= 0) continue;
    const p = person(state, id);
    const frac = amount / Math.max(1, p.salary);
    p.satisfaction = clamp(p.satisfaction + clamp(frac * 40 * greedFactor(p), 1, 10));
    adjustOpinion(state, id, state.player.personId, Math.round(clamp(frac * 20, 1, 8)));
    addLifeEvent(state, id, 'bonus', `Awarded a ${formatZuzu(amount)} bonus.`, clamp(Math.round(frac * 10), 1, 3), true);
  }
  const leftover = pool - total;
  state.company.cash += leftover;
  state.company.bonusPool = 0;
  addLog(state, `Paid out ${formatZuzu(total)} in bonuses; ${formatZuzu(leftover)} returned to cash.`, 2);
  return ok(`Paid ${formatZuzu(total)} in bonuses. ${formatZuzu(leftover)} returned to cash.${snubbed ? ` ${snubbed} people who expected a share got almost nothing.` : ''}`);
}

export function setBudget(state: GameState, unitId: UnitId, budget: number): ActionResult {
  const pre = precheck(state, ATTENTION_COST.setBudget);
  if (pre) return pre;
  const u = state.units[unitId];
  if (!u) return fail('No such unit.');
  if (!Number.isFinite(budget) || budget < 0) return fail('A budget cannot be negative.');
  budget = Math.round(budget);
  const old = u.budget;
  if (budget === old) return fail('That is already the budget.');
  u.budget = budget;
  const lead = u.leadId && u.leadId !== state.player.personId ? state.people[u.leadId] : null;
  if (lead && lead.status === 'active') {
    const change = old > 0 ? (budget - old) / old : 0.3;
    const swing = Math.round(clamp(change * 40, -15, 15));
    adjustOpinion(state, lead.id, state.player.personId, swing);
    if (swing !== 0) adjustLoyalty(state, lead.id, Math.round(swing / 3));
  }
  addLog(state, `${u.name} budget set to ${formatZuzu(budget)} a month.`, 1, lead ? [lead.id] : []);
  return ok(`${u.name} budget is now ${formatZuzu(budget)} a month${lead ? ` (was ${formatZuzu(old)}); ${lead.lastName} noticed` : ''}.`);
}

// ---- Restructuring ----

const ALLOWED_PARENTS: Record<UnitKind, UnitKind[]> = {
  executive: [],
  function: ['executive'],
  division: ['executive', 'function'],
  subdivision: ['division', 'subdivision'],
  team: ['division', 'subdivision', 'function'],
  subteam: ['team', 'subteam'],
};

function divisionFor(parent: OrgUnit): UnitId | null {
  return parent.kind === 'division' ? parent.id : parent.divisionId;
}

/** Re-stamps divisionId over a whole subtree after it moved. */
function restamp(state: GameState, rootId: UnitId, div: UnitId | null): void {
  for (const x of unitsUnder(state, rootId)) x.divisionId = x.kind === 'division' ? x.id : div;
}

function lowerBy(state: GameState, leadId: PersonId | null, opinion: number, loyalty: number): void {
  if (!leadId || leadId === state.player.personId) return;
  const m = state.people[leadId];
  if (!m || m.status !== 'active') return;
  adjustOpinion(state, leadId, state.player.personId, opinion);
  adjustLoyalty(state, leadId, loyalty);
}

function depthOf(state: GameState, id: UnitId): number {
  let d = 0;
  for (let u = unit(state, id); u.parentId; u = unit(state, u.parentId)) d++;
  return d;
}

export function moveUnit(state: GameState, unitId: UnitId, newParentId: UnitId): ActionResult {
  const pre = precheck(state, ATTENTION_COST.restructure);
  if (pre) return pre;
  const u = state.units[unitId];
  const parent = state.units[newParentId];
  if (!u || !parent) return fail('No such unit.');
  if (u.id === state.rootUnitId || u.parentId === null) return fail("The CEO's office can't be moved.");
  if (u.parentId === newParentId) return fail(`${u.name} already reports there.`);
  if (unitsUnder(state, unitId).some((x) => x.id === newParentId)) return fail('A unit cannot move under itself.');
  if (!ALLOWED_PARENTS[u.kind].includes(parent.kind)) return fail(`A ${u.kind} cannot sit under a ${parent.kind}.`);

  const oldParent = unit(state, u.parentId);
  const before = depthOf(state, unitId);
  oldParent.childIds = oldParent.childIds.filter((c) => c !== unitId);
  parent.childIds.push(unitId);
  u.parentId = newParentId;
  restamp(state, unitId, divisionFor(parent));

  const delta = depthOf(state, unitId) - before;
  const lead = u.leadId && u.leadId !== state.player.personId ? person(state, u.leadId) : null;
  if (lead) {
    const o = delta > 0 ? -(4 + 2 * delta) : delta < 0 ? 4 : -2;
    lowerBy(state, lead.id, o, Math.round(o / 2));
    addLifeEvent(state, lead.id, 'restructure', `${u.name} was moved under ${parent.name}.`, delta > 0 ? -2 : delta < 0 ? 2 : 0, true);
  }
  lowerBy(state, oldParent.leadId, -4, -1); // losing a unit stings
  lowerBy(state, parent.leadId, 3, 0);
  spend(state, ATTENTION_COST.restructure);
  addLog(state, `Moved ${u.name} from ${oldParent.name} to ${parent.name}.`, 2, lead ? [lead.id] : []);
  return ok(`${u.name} now reports into ${parent.name}.`);
}

/** Folds `absorbId` into `keepId`: members and child units move over, its lead becomes a member. */
export function mergeUnits(state: GameState, keepId: UnitId, absorbId: UnitId): ActionResult {
  const pre = precheck(state, ATTENTION_COST.restructure);
  if (pre) return pre;
  const keep = state.units[keepId];
  const absorb = state.units[absorbId];
  if (!keep || !absorb) return fail('No such unit.');
  if (keepId === absorbId) return fail('A unit cannot merge with itself.');
  if (keep.kind === 'executive') return fail("The CEO's office can't absorb a unit.");
  if (absorb.kind === 'executive' || absorb.kind === 'division' || absorb.kind === 'function') {
    return fail(`A ${absorb.kind} can't be merged away.`);
  }
  if (unitsUnder(state, absorbId).some((x) => x.id === keepId)) return fail('A unit cannot absorb its own parent.');
  for (const c of absorb.childIds) {
    if (!ALLOWED_PARENTS[unit(state, c).kind].includes(keep.kind)) return fail(`${absorb.name}'s sub-units can't sit under a ${keep.kind}.`);
  }

  const lead = absorb.leadId && absorb.leadId !== state.player.personId ? person(state, absorb.leadId) : null;
  const members = absorb.memberIds.slice();
  const keepLead = keep.leadId;
  if (lead) {
    placeAsMember(state, lead.id, keepId);
    lead.title = memberTitle(keep);
    lead.satisfaction = clamp(lead.satisfaction - 15);
    lowerBy(state, lead.id, -15, -10);
    addLifeEvent(state, lead.id, 'unitMerged', `Lost the lead of ${absorb.name} when it was merged into ${keep.name}.`, -4, true);
  }
  for (const id of members) {
    const m = person(state, id);
    const seat = m.title === memberTitle(absorb);
    placeAsMember(state, id, keepId);
    if (seat) m.title = memberTitle(keep);
  }
  for (const c of absorb.childIds.slice()) {
    unit(state, c).parentId = keepId;
    keep.childIds.push(c);
    restamp(state, c, divisionFor(keep));
  }
  absorb.childIds = [];
  const oldParent = absorb.parentId ? unit(state, absorb.parentId) : null;
  if (oldParent) oldParent.childIds = oldParent.childIds.filter((c) => c !== absorbId);
  keep.budget += absorb.budget;
  keep.morale = clamp(Math.round((keep.morale + absorb.morale) / 2) - 5);
  delete state.units[absorbId];
  lowerBy(state, keepLead, 3, 0);
  spend(state, ATTENTION_COST.restructure);
  addLog(state, `Merged ${absorb.name} into ${keep.name}.`, 2, lead ? [lead.id] : []);
  return ok(`${absorb.name} is now part of ${keep.name}.${lead ? ` ${lead.lastName} lost ${pronoun(lead, 'possessive')} seat.` : ''}`);
}

/** Creates an empty unit under a parent. */
export function createUnit(
  state: GameState,
  parentId: UnitId,
  kind: Exclude<UnitKind, 'executive' | 'function'> | 'function',
  name: string,
  functionKind?: FunctionKind,
): ActionResult {
  const pre = precheck(state, ATTENTION_COST.restructure);
  if (pre) return pre;
  const parent = state.units[parentId];
  if (!parent) return fail('No such unit.');
  name = (name ?? '').trim();
  if (!name) return fail('The unit needs a name.');
  if (name.length > 40) return fail('That name is too long.');
  if ((kind as string) === 'division') return fail('New business lines come through the board, not a reorganisation.');
  if (!ALLOWED_PARENTS[kind]?.includes(parent.kind)) return fail(`A ${kind} cannot sit under a ${parent.kind}.`);
  if (kind === 'function') {
    if (!functionKind) return fail('A corporate function needs a kind.');
    if (Object.values(state.units).some((x) => x.functionKind === functionKind)) return fail('That function already exists.');
  }
  const id = newId(state, 'u');
  const u: OrgUnit = {
    id, name, kind, parentId, childIds: [], leadId: null, memberIds: [],
    budget: 0, morale: 60, output: 100,
    divisionId: divisionFor(parent),
    functionKind: kind === 'function' ? functionKind ?? null : null,
    investigatedMonth: null,
  };
  state.units[id] = u;
  parent.childIds.push(id);
  spend(state, ATTENTION_COST.restructure);
  addLog(state, `Created ${name} under ${parent.name}.`, 1);
  return ok(`Created ${name} under ${parent.name}. It has no lead yet.`);
}

/** Removes a unit; its people and child units move up to its parent. */
export function dissolveUnit(state: GameState, unitId: UnitId): ActionResult {
  const pre = precheck(state, ATTENTION_COST.restructure);
  if (pre) return pre;
  const u = state.units[unitId];
  if (!u) return fail('No such unit.');
  if (u.parentId === null || u.kind === 'executive') return fail("The CEO's office can't be dissolved.");
  if (u.kind === 'division' || u.kind === 'function') return fail(`A ${u.kind} can't be dissolved.`);
  const parent = unit(state, u.parentId);
  for (const c of u.childIds) {
    if (!ALLOWED_PARENTS[unit(state, c).kind].includes(parent.kind)) return fail(`${u.name}'s sub-units can't sit under ${parent.name}.`);
  }

  const lead = u.leadId && u.leadId !== state.player.personId ? person(state, u.leadId) : null;
  if (lead) {
    placeAsMember(state, lead.id, parent.id);
    lead.title = memberTitle(parent);
    lead.satisfaction = clamp(lead.satisfaction - 15);
    lowerBy(state, lead.id, -15, -10);
    addLifeEvent(state, lead.id, 'unitDissolved', `Lost the lead of ${u.name} when it was dissolved.`, -4, true);
  }
  for (const id of u.memberIds.slice()) {
    const m = person(state, id);
    const seat = m.title === memberTitle(u);
    placeAsMember(state, id, parent.id);
    if (seat) m.title = memberTitle(parent);
  }
  for (const c of u.childIds.slice()) {
    unit(state, c).parentId = parent.id;
    parent.childIds.push(c);
  }
  parent.childIds = parent.childIds.filter((c) => c !== unitId);
  parent.budget += u.budget;
  delete state.units[unitId];
  lowerBy(state, parent.leadId, -2, 0);
  spend(state, ATTENTION_COST.restructure);
  addLog(state, `Dissolved ${u.name}.`, 2, lead ? [lead.id] : []);
  return ok(`Dissolved ${u.name}; its people now sit in ${parent.name}.`);
}

// ---- Meetings ----

export type MeetingApproach = 'rapport' | 'promise' | 'threaten' | 'probe';

export interface MeetingPromise {
  kind: PromiseKind;
  detail: string;
  /** Months the player has to keep it. */
  months: number;
}

/** The player's social pull, around 1.0 for an average executive. */
function charmOf(state: GameState): number {
  const me = person(state, state.player.personId);
  let c = (me.skills.management * 0.6 + me.skills.guile * 0.4) / 50;
  if (me.traits.includes('charming')) c *= 1.3;
  if (me.traits.includes('ruthless')) c *= 0.9;
  return c;
}

function rapportMod(p: Person): number {
  let m = 1;
  if (p.traits.includes('paranoid')) m *= 0.5;
  if (p.traits.includes('vain')) m *= 1.2;
  if (p.traits.includes('petty')) m *= 0.8;
  if (p.traits.includes('generous')) m *= 1.1;
  return m;
}

const PROMISE_LABEL: Record<PromiseKind, string> = {
  promotion: 'a promotion',
  raise: 'a raise',
  protection: 'protection',
  budget: 'more budget',
};


function baselineFor(p: Person, state: GameState, kind: PromiseKind): number | null {
  if (kind === 'raise') return p.salary;
  if (kind === 'promotion') return ROLE_RANK[p.role];
  if (kind === 'budget') return p.unitId ? unit(state, p.unitId).budget : null;
  return null;
}

export function meet(state: GameState, personId: PersonId, approach: MeetingApproach, promise?: MeetingPromise): ActionResult {
  const pre = precheck(state, ATTENTION_COST.meet);
  if (pre) return pre;
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  const me = person(state, state.player.personId);
  const name = fullName(p);
  const charm = charmOf(state);

  if (approach === 'promise') {
    if (!promise) return fail('Say what you are promising.');
    if (!Number.isInteger(promise.months) || promise.months < 1 || promise.months > PROMISE_MAX_MONTHS) return fail(`Give a deadline of 1 to ${PROMISE_MAX_MONTHS} months.`);
    if (!promise.detail.trim()) return fail('Say what you are promising.');
    if (promise.kind === 'budget' && !isLead(state, p)) return fail('Only a unit lead can be promised budget.');
    if (state.promises.some((x) => x.state === 'open' && x.personId === personId && x.kind === promise.kind)) {
      return fail(`You have already promised ${pronoun(p, 'object')} ${PROMISE_LABEL[promise.kind]}.`);
    }
  }

  const skip = applySkip(state, [chainOfCommand(state, personId)], personId, SKIP_MEETING_STRENGTH);
  spend(state, ATTENTION_COST.meet);

  if (approach === 'rapport') {
    const mod = rapportMod(p);
    const o = Math.max(1, Math.round(6 * charm * mod));
    adjustOpinion(state, personId, me.id, o);
    adjustLoyalty(state, personId, Math.max(0, Math.round(4 * charm * mod)));
    p.satisfaction = clamp(p.satisfaction + 2);
    return ok(`You spent an hour with ${name}. ${cap(pronoun(p, 'subject'))} left ${o >= 6 ? 'warmer toward you' : 'a little less guarded'}.${skip}`);
  }

  if (approach === 'promise') {
    const pr = promise!;
    const id = newId(state, 'pr');
    const base = baselineFor(p, state, pr.kind);
    state.promises.push({
      id, personId, kind: pr.kind, madeMonth: state.month, dueMonth: state.month + pr.months, detail: pr.detail.trim(), state: 'open',
      ...(base !== null ? { baseline: base } : {}),
    });
    adjustLoyalty(state, personId, PROMISE_LOYALTY);
    adjustOpinion(state, personId, me.id, PROMISE_OPINION);
    addLifeEvent(state, personId, 'promised', `The CEO promised ${pronoun(p, 'object')} ${PROMISE_LABEL[pr.kind]}: ${pr.detail.trim()}`, 1, true);
    addLog(state, `Promised ${name} ${PROMISE_LABEL[pr.kind]} within ${pr.months} months.`, 1, [personId]);
    return ok(`${name} took you at your word. It is due in ${pr.months} month${pr.months === 1 ? '' : 's'}.${skip}`);
  }

  if (approach === 'threaten') {
    const paranoid = p.traits.includes('paranoid');
    let loyaltyNote = '';
    p.involvement = clamp(p.involvement - (p.traits.includes('reckless') ? 5 : 15));
    adjustOpinion(state, personId, me.id, paranoid ? -14 : -10);
    if (paranoid) adjustLoyalty(state, personId, -5);
    addLifeEvent(state, personId, 'threatened', 'Was threatened by the CEO in a private meeting.', -3, true);
    ripple(state, personId, -3);
    if (setbackPlot(state, personId, THREAT_PLOT_SETBACK)) loyaltyNote = ' The campaign loses its nerve.';
    let extra = '';
    if ((p.traits.includes('ruthless') || p.traits.includes('vain')) && chance(state, 0.5)) {
      adjustOpinion(state, personId, me.id, -10);
      adjustLoyalty(state, personId, -8);
      state.incidents.push({ kind: 'scheme', personIds: [personId, me.id], unitId: p.unitId, data: { against: me.id, reason: 'threatened' } });
      extra = ` ${cap(pronoun(p, 'subject'))} did not take it quietly.`;
    } else if (p.traits.includes('principled') && chance(state, 0.5) && state.directors.length) {
      const d = pick(state, state.directors);
      adjustOpinion(state, d.personId, me.id, -8);
      state.company.boardConfidence = clamp(state.company.boardConfidence - 3);
      state.incidents.push({ kind: 'complaint', personIds: [personId, bossOf(state, personId) ?? me.id], unitId: p.unitId, data: { about: me.id, director: d.personId, reason: 'threatened' } });
      extra = ` ${cap(pronoun(p, 'subject'))} took it to the board.`;
    }
    addLog(state, `Threatened ${name}.`, 1, [personId]);
    return ok(`${name} will keep ${pronoun(p, 'possessive')} head down for now.${loyaltyNote}${extra}${skip}`);
  }

  // probe
  const odds = clamp(0.5 + (me.skills.guile - p.skills.guile) / 100 - (p.traits.includes('paranoid') ? 0.15 : 0), 0.15, 0.9);
  const learned: string[] = [];
  if (chance(state, odds)) {
    p.investigatedMonth = state.month;
    learned.push('who ' + pronoun(p, 'subject') + (p.pronouns === 'they' ? ' trust' : ' trusts') + ' and who ' + pronoun(p, 'subject') + (p.pronouns === 'they' ? ' resent' : ' resents'));
    const c = p.cliqueId ? state.cliques[p.cliqueId] : null;
    if (c) {
      c.known = true;
      learned.push(`that ${pronoun(p, 'subject')} ${p.pronouns === 'they' ? 'run' : 'runs'} with ${c.name}`);
    }
    const hidden = p.secrets.find((s) => !s.revealed);
    if (hidden && chance(state, odds * 0.6)) {
      hidden.revealed = true;
      learned.push(`a secret: ${hidden.description}`);
      addLifeEvent(state, personId, 'exposed', `A private meeting with the CEO drew out a secret: ${hidden.description}`, -2, true);
    }
  } else if (p.traits.includes('paranoid')) {
    adjustOpinion(state, personId, me.id, -4);
  }
  addLog(state, `Probed ${name}.`, 1, [personId]);
  return ok(learned.length ? `Probing ${name}, you learned ${learned.join('; ')}.${skip}` : `${name} gave you nothing.${skip}`);
}

// ---- Security ----

/** The lead of the security function, if the seat is filled. */
function securityHead(state: GameState): Person | null {
  const u = Object.values(state.units).find((x) => x.functionKind === 'security');
  const lead = u?.leadId ? state.people[u.leadId] : null;
  return lead && lead.status === 'active' ? lead : null;
}

const effort = (head: Person) => (head.skills.work * 0.6 + head.skills.guile * 0.4) / 100;

function findChance(head: Person, target: Person, severity: number, scale = 1): number {
  return clamp((effort(head) + 0.1 - 0.05 * (severity - 1) - (target.skills.guile - 50) / 200) * scale, 0.1, 0.95);
}

/** Possibly makes a paranoid target notice the digging. */
function noticed(state: GameState, target: Person, base: number): boolean {
  const p = target.traits.includes('paranoid') ? 0.6 : base;
  if (!chance(state, p)) return false;
  adjustOpinion(state, target.id, state.player.personId, -10);
  adjustLoyalty(state, target.id, -6);
  return true;
}

/** Security digs into a person: reveals some of their secrets and relationships. */
export function investigatePerson(state: GameState, personId: PersonId): ActionResult {
  const pre = precheck(state, ATTENTION_COST.investigatePerson);
  if (pre) return pre;
  const p = state.people[personId];
  if (!p || p.status !== 'active') return fail('That person is no longer with the company.');
  if (personId === state.player.personId) return fail("You can't investigate yourself.");
  const head = securityHead(state);
  if (!head) return fail('There is no Head of Security to run it.');
  if (head.id === personId) return fail('Security cannot investigate its own head.');

  spend(state, ATTENTION_COST.investigatePerson);
  p.investigatedMonth = state.month;
  const found = p.secrets.filter((s) => !s.revealed && chance(state, findChance(head, p, s.severity)));
  for (const s of found) s.revealed = true;
  const c = p.cliqueId ? state.cliques[p.cliqueId] : null;
  if (c && chance(state, findChance(head, p, 1))) c.known = true;
  const saw = noticed(state, p, 0.15);
  if (found.length) {
    addLifeEvent(state, personId, 'investigated', `Security uncovered: ${found.map((s) => s.description).join('; ')}`, -3, true);
  } else if (saw) {
    addLifeEvent(state, personId, 'investigated', 'Found out Security had been digging into them.', -1, true);
  }
  addLog(state, `${fullName(head)} investigated ${fullName(p)}.`, 2, [personId, head.id]);
  const body = found.length
    ? `${found.length === 1 ? 'a secret' : `${found.length} secrets`}: ${found.map((s) => s.description).join('; ')}`
    : 'nothing damaging';
  return ok(`${head.lastName}'s team found ${body} on ${fullName(p)}.${saw ? ` ${cap(pronoun(p, 'subject'))} noticed.` : ''}`);
}

/** Security digs into a unit: reveals feuds, cliques and who really does the work there. */
export function investigateUnit(state: GameState, unitId: UnitId): ActionResult {
  const pre = precheck(state, ATTENTION_COST.investigateUnit);
  if (pre) return pre;
  const u = state.units[unitId];
  if (!u) return fail('No such unit.');
  const head = securityHead(state);
  if (!head) return fail('There is no Head of Security to run it.');

  spend(state, ATTENTION_COST.investigateUnit);
  const ids = peopleUnder(state, unitId).filter((id) => id !== state.player.personId && state.people[id]?.status === 'active');
  const inUnit = new Set(ids);
  for (const x of unitsUnder(state, unitId)) x.investigatedMonth = state.month;
  let secrets = 0;
  let noticedBy = 0;
  for (const id of ids) {
    const p = person(state, id);
    p.investigatedMonth = state.month;
    for (const s of p.secrets) if (!s.revealed && chance(state, findChance(head, p, s.severity, 0.7))) { s.revealed = true; secrets++; }
    if (id !== head.id && noticed(state, p, 0.05)) noticedBy++;
  }
  const cliques = Object.values(state.cliques).filter((c) => c.memberIds.some((m) => inUnit.has(m)));
  for (const c of cliques) c.known = true;
  let feuds = 0;
  for (const a of ids) for (const [b, rel] of Object.entries(state.relations[a] ?? {})) {
    if (inUnit.has(b) && (rel.tag === 'rival' || rel.tag === 'grudge')) feuds++;
  }
  const workers = ids.map((id) => person(state, id)).filter((p) => !isLead(state, p));
  const star = workers.sort((a, b) => b.performance - a.performance)[0];
  addLog(state, `${fullName(head)} investigated ${u.name}.`, 2, [head.id]);
  const parts = [`${secrets} secret${secrets === 1 ? '' : 's'}`, `${feuds} feud${feuds === 1 ? '' : 's'}`, `${cliques.length} clique${cliques.length === 1 ? '' : 's'}`];
  return ok(`${head.lastName}'s review of ${u.name} turned up ${parts.join(', ')}.${star ? ` Most of the real work comes from ${fullName(star)}.` : ''}${noticedBy ? ` ${noticedBy} noticed the digging.` : ''}`);
}

// ---- Board ----

export type LobbyApproach = 'persuade' | 'favor' | 'pressure';

/** How the last few months look to the board, roughly 0.2 to 1.5. */
function recentPerformance(state: GameState): number {
  const h = state.company.history;
  const now = state.company.sharePrice;
  const then = h.length >= 3 ? h[h.length - 3].sharePrice : (h[0]?.sharePrice ?? now);
  const growth = now / Math.max(0.01, then) - 1;
  return clamp(0.5 + growth * 5 + (state.company.boardConfidence - 50) / 100, 0.2, 1.5);
}

export function lobbyDirector(state: GameState, directorId: PersonId, approach: LobbyApproach): ActionResult {
  const pre = precheck(state, ATTENTION_COST.lobbyDirector);
  if (pre) return pre;
  const d = state.people[directorId];
  if (!d || d.status !== 'active' || !state.directors.some((x) => x.personId === directorId)) return fail('That person is not on the board.');
  const me = state.player.personId;
  const name = fullName(d);
  let delta = 0;
  let message: string;

  if (approach === 'persuade') {
    delta = Math.max(1, Math.round(5 * recentPerformance(state) * Math.min(1.3, charmOf(state)) + (d.traits.includes('vain') ? 1 : 0)));
    message = `You walked ${name} through the numbers. ${cap(pronoun(d, 'subject'))} ${d.pronouns === 'they' ? 'are' : 'is'} more receptive.`;
  } else if (approach === 'favor') {
    if (state.player.personalCash < FAVOR_COST) return fail(`A favor costs ${formatZuzu(FAVOR_COST)}; you don't have it.`);
    state.player.personalCash -= FAVOR_COST;
    if (d.traits.includes('principled')) {
      delta = -8;
      message = `${name} took your favor as a bribe and said so.`;
    } else {
      delta = Math.round(FAVOR_SWING * (0.6 + d.greed / 100));
      message = `${name} accepted your favor, at a cost of ${formatZuzu(FAVOR_COST)}.`;
      addLifeEvent(state, directorId, 'favor', 'Accepted a personal favor from the CEO.', 1, true);
    }
  } else {
    const secret = d.secrets.filter((s) => s.revealed).sort((a, b) => b.severity - a.severity)[0];
    if (secret) {
      delta = 15 + 10 * secret.severity;
      message = `You let ${name} know what you knew. ${cap(pronoun(d, 'subject'))} fell in line.`;
      addLifeEvent(state, directorId, 'pressured', `Was pressured over ${secret.description}`, -3, true);
    } else {
      delta = PRESSURE_BACKFIRE;
      state.company.boardConfidence = clamp(state.company.boardConfidence - 4);
      message = `${name} had nothing to fear from you and went to the other directors about it.`;
    }
  }
  adjustOpinion(state, directorId, me, delta);
  if (delta > 0) state.company.boardConfidence = clamp(state.company.boardConfidence + Math.round(delta / 8));
  spend(state, ATTENTION_COST.lobbyDirector);
  addLog(state, `Lobbied ${name} (${approach}).`, 2, [directorId]);
  return ok(message);
}

/** Announces profit guidance for the current quarter. Only once per quarter. */
export function setGuidance(state: GameState, amount: number): ActionResult {
  const pre = precheck(state, ATTENTION_COST.setGuidance);
  if (pre) return pre;
  if (state.company.guidance !== null) return fail('Guidance for this quarter is already public.');
  if (!Number.isFinite(amount) || amount <= 0) return fail('Guidance must be a positive profit figure.');
  state.company.guidance = Math.round(amount);
  addLog(state, `Announced profit guidance of ${formatZuzu(state.company.guidance)} for the quarter.`, 2);
  return ok(`Guidance set at ${formatZuzu(state.company.guidance)}.`);
}

// ---- Promises ----

function fulfilled(state: GameState, pr: { id: string; kind: PromiseKind; madeMonth: number; dueMonth: number; baseline?: number }, p: Person): boolean {
  const base = pr.baseline ?? null;
  switch (pr.kind) {
    case 'promotion':
      return base !== null ? ROLE_RANK[p.role] > base : isLead(state, p);
    case 'raise':
      return base !== null
        ? p.salary >= base * (1 + RAISE_PROMISE_FRACTION)
        : p.history.some((e: LifeEvent) => e.byPlayer && e.kind === 'raise' && e.month >= pr.madeMonth);
    case 'budget':
      return base !== null && p.unitId !== null && unit(state, p.unitId).budget > base;
    case 'protection':
      return state.month >= pr.dueMonth; // still employed when it falls due
  }
}

/** Marks promises kept or broken as their due month passes, with consequences. Run monthly. */
export function checkPromises(state: GameState): void {
  const me = state.player.personId;
  for (const pr of state.promises) {
    if (pr.state !== 'open') continue;
    const p = state.people[pr.personId];
    if (!p) { pr.state = 'broken'; continue; }
    if (p.status !== 'active') {
      // Moot once they are gone; only a protection promise to someone fired counts against the player.
      pr.state = 'broken';
      if (pr.kind === 'protection' && p.status === 'fired') {
        ripple(state, p.id, -BROKEN_FRIEND_OPINION, -3);
        addLog(state, `The CEO's promise to protect ${fullName(p)} came to nothing.`, 2, [p.id]);
      }
      continue;
    }
    if (fulfilled(state, pr, p)) {
      pr.state = 'kept';
      adjustLoyalty(state, p.id, KEPT_LOYALTY);
      adjustOpinion(state, p.id, me, KEPT_OPINION);
      addLifeEvent(state, p.id, 'promiseKept', `The CEO kept ${pronoun(p, 'possessive')} promise: ${pr.detail}`, 2, true);
      addLog(state, `Kept the promise to ${fullName(p)}: ${pr.detail}`, 1, [p.id]);
    } else if (state.month >= pr.dueMonth) {
      pr.state = 'broken';
      adjustLoyalty(state, p.id, -BROKEN_LOYALTY);
      adjustOpinion(state, p.id, me, -BROKEN_OPINION);
      p.satisfaction = clamp(p.satisfaction - 10);
      state.player.reputation = clamp(state.player.reputation - 2);
      ripple(state, p.id, -BROKEN_FRIEND_OPINION, -3);
      addLifeEvent(state, p.id, 'promiseBroken', `The CEO broke ${pronoun(p, 'possessive')} promise: ${pr.detail}`, -5, true);
      addLog(state, `Broke the promise to ${fullName(p)}: ${pr.detail}`, 2, [p.id]);
    }
  }
}

/** Retire from the company. Ends the game. */
export function retire(state: GameState): ActionResult {
  if (state.gameOver) return fail('The game is over.');
  endGame(state, 'retired');
  return ok('You stepped down as CEO.');
}
