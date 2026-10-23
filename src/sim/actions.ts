// Everything the player can do on their turn. Each action checks and spends
// attention, applies the skip-level penalty when the player goes around the
// people who should handle it, records life events, and returns a result.
import type {
  ActionResult,
  FunctionKind,
  GameState,
  OrgUnit,
  Person,
  PersonId,
  PromiseKind,
  Role,
  UnitId,
  UnitKind,
} from './types';
import { createPerson } from './generate';
import { bonusWeights } from './economy';
import { endGame } from './epilogue';
import {
  addLifeEvent,
  addLog,
  adjustLoyalty,
  adjustOpinion,
  adjustSatisfaction,
  bossOf,
  chainOfCommand,
  formatZuzu,
  fullName,
  hasAttention,
  isActive,
  newId,
  isDirector,
  isLead,
  opinionOf,
  peopleUnder,
  person,
  placeAsMember,
  pronoun,
  removeFromCompany,
  seatLead,
  unit,
  unitAncestry,
  unitsUnder,
  verb,
  be,
  shortName,
} from './org';
import { ALLOWED_PARENTS, marketSalary, roleForUnitKind, roleRank } from './roles';
import { chance, pick, randInt } from './rng';
import { setbackPlot } from './plots';
import { PROMISE_LABEL, PROMISE_MAX_MONTHS, makePromise } from './promises';
import { attentionCost, trySpend, type AttentionAction } from './attention';
import { ripple, sponsorsOf } from './ties';
import {
  DIRECTOR_PERSUADED,
  PROBE_CLOSED,
  PROBE_TALKED,
  PROMISE_REPLY,
  RAPPORT_GUARDED,
  RAPPORT_WARM,
  THREAT_CALM,
  THREAT_DEFIANT,
  reply,
  variant,
} from './voice';
import { capitalize, clamp, fail, ok, roundTo, sum } from './util';

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

const PROMOTION_RAISE_MIN = 12;
const PROMOTION_RAISE_MAX = 20;
const DEMOTION_PAY_CUT = 0.1;
const PASSED_OVER_AMBITION = 55;

const OPTION_GRANT_MAX_FRACTION = 0.005;

const PROMISE_LOYALTY = 10;
const PROMISE_OPINION = 6;

/** Firing an officer takes the board's notice. */
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

// ---- Shared helpers ----

/** Spends the attention an action costs, or returns why it can't be done. Call after validating, before acting. */
function spend(state: GameState, action: AttentionAction, targetId?: PersonId): ActionResult | null {
  return trySpend(state, attentionCost(state, action, targetId));
}

/** A staff member the player may act on: active, in the tree, not the player, not on the board. */
function staffTarget(state: GameState, id: PersonId): Person | ActionResult {
  const p = state.people[id];
  if (!p || !isActive(p)) return fail('That person is no longer with the company.');
  if (id === state.player.personId) return fail("You can't do that to yourself.");
  if (isDirector(state, p)) return fail('Directors answer to the board, not to you.');
  if (p.unitId === null) return fail('That person has no post in the company.');
  return p;
}
const isFail = (x: Person | ActionResult): x is ActionResult => 'ok' in x;

/** A successful result with the person's reply attached, for the UI to play as a scene. */
function withScene(result: ActionResult, speaker: Person, line: string): ActionResult {
  return { ...result, scene: { speakerId: speaker.id, line } };
}

/** Leads from this unit (or its parent) up to the root, excluding the player; immediate boss first. */
function leadsFromUnit(state: GameState, unitId: UnitId, includeOwn: boolean): PersonId[] {
  const chain = unitAncestry(state, unitId);
  const out: PersonId[] = [];
  for (const u of includeOwn ? chain : chain.slice(1)) {
    if (u.leadId && u.leadId !== state.player.personId && !out.includes(u.leadId)) out.push(u.leadId);
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
  const bypassed = isActive(t) ? chainOfCommand(state, targetId).filter((id) => id !== state.player.personId) : [];
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
    if (!m || !isActive(m)) continue;
    adjustLoyalty(state, id, -Math.round(w * strength));
    adjustOpinion(state, id, state.player.personId, -Math.round((w * strength) / 2));
    names.push(shortName(m));
    lastObj = pronoun(m, 'object');
  }
  if (names.length === 0) return '';
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return ` ${who} will remember you went around ${names.length === 1 ? lastObj : 'them'}.`;
}

/** Ambitious members of a unit resent a lead appointed over them. */
function resentPassedOver(state: GameState, u: OrgUnit, except: PersonId[]): void {
  for (const id of u.memberIds.slice()) {
    const m = state.people[id];
    if (!m || !isActive(m) || except.includes(id) || m.ambition < PASSED_OVER_AMBITION) continue;
    adjustOpinion(state, id, state.player.personId, -(2 + Math.round(m.ambition / 25)));
    adjustSatisfaction(state, id, -4);
    addLifeEvent(state, id, 'passedOver', `Passed over for the lead of ${u.name}.`, -2, true);
  }
}

// ---- Hiring and firing ----

/** Hires a new person into a unit, as its lead (if the seat is empty) or as a member. */
export function hire(state: GameState, unitId: UnitId, asLead: boolean, tier: HireTier): ActionResult {
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
  const blocked = spend(state, 'hire');
  if (blocked) return blocked;

  const p = createPerson(state, { role, quality, salary });
  p.salary = salary;
  p.hiredMonth = state.month;
  p.loyalty = clamp(p.loyalty + HIRE_LOYALTY_BONUS);
  const groups = [leadsFromUnit(state, unitId, !asLead)];
  if (asLead) seatLead(state, unitId, p.id);
  else placeAsMember(state, p.id, unitId);
  adjustOpinion(state, p.id, state.player.personId, 10);
  state.company.cash -= fee;
  const skip = applySkip(state, groups, null);
  addLifeEvent(state, p.id, 'hired', `Hired as ${p.title} at ${formatZuzu(salary)} a year.`, 5, true);
  if (asLead) resentPassedOver(state, u, [p.id]);
  addLog(state, `Hired ${fullName(p)} as ${p.title}.`, asLead ? 2 : 1, [p.id]);
  return ok(`Hired ${fullName(p)} as ${p.title} at ${formatZuzu(salary)}${fee ? `, plus a ${formatZuzu(fee)} recruiter fee` : ''}.${skip}`);
}

export function fire(state: GameState, personId: PersonId): ActionResult {
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  const blocked = spend(state, 'fire', personId);
  if (blocked) return blocked;

  const groups = [chainOfCommand(state, personId)];
  const skip = applySkip(state, groups, personId);
  const protectors = sponsorsOf(state, personId);
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
  addLog(state, `Fired ${fullName(p)} (${title}).`, p.role === 'worker' ? 1 : 2, [personId]);
  let boardNote = '';
  if (p.role === 'officer') {
    // The board does not like watching the C-suite get purged without a reason.
    const cause = p.secrets.some((x) => x.revealed && x.severity >= 2);
    const k = cause ? FOR_CAUSE_SHARE : 1;
    state.company.boardConfidence = clamp(state.company.boardConfidence - OFFICER_FIRE_CONFIDENCE * k);
    let upset = 0;
    for (const d of state.directors) {
      const op = opinionOf(state, d.personId, personId);
      if (op < ALLY_CLOSE || !isActive(person(state, d.personId))) continue;
      adjustOpinion(state, d.personId, state.player.personId, -Math.round((OFFICER_FIRE_ALLY_OPINION * k * op) / 50));
      upset++;
    }
    boardNote = ` The board ${cause ? 'accepts the cause shown' : 'is unsettled'}${upset ? `; ${upset} director${upset === 1 ? '' : 's'} close to ${pronoun(p, 'object')} took it badly` : ''}.`;
  }
  const angry = protectors.length ? ` ${shortName(state.people[protectors[0]])}, who backed ${pronoun(p, 'object')}, took it badly.` : '';
  return ok(`Fired ${fullName(p)}. Severance ${formatZuzu(severance)}.${angry}${boardNote}${skip}`);
}

// ---- Seats ----

/** Makes the person lead of the unit. A sitting lead is moved down to a member of it. */
export function promote(state: GameState, personId: PersonId, unitId: UnitId): ActionResult {
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  const u = state.units[unitId];
  if (!u) return fail('No such unit.');
  if (u.kind === 'executive') return fail('That seat is yours.');
  if (u.leadId === personId) return fail(`${fullName(p)} already leads ${u.name}.`);
  if (roleRank[roleForUnitKind[u.kind]] <= roleRank[p.role]) return fail(`That would not be a promotion for ${fullName(p)}.`);
  const blocked = spend(state, 'promote');
  if (blocked) return blocked;

  const groups = [chainOfCommand(state, personId), leadsFromUnit(state, unitId, false)];
  const skip = applySkip(state, groups, personId);
  const wasLeadOf = isLead(state, p) ? unit(state, p.unitId!) : null;

  const displaced = seatLead(state, unitId, personId);
  const pct = randInt(state, PROMOTION_RAISE_MIN, PROMOTION_RAISE_MAX) / 100;
  p.salary = roundTo(p.salary * (1 + pct), 500);
  adjustSatisfaction(state, personId, 10);
  adjustLoyalty(state, personId, 8);
  adjustOpinion(state, personId, state.player.personId, 10);
  addLifeEvent(state, personId, 'promoted', `Promoted to lead ${u.name}; salary rose to ${formatZuzu(p.salary)}.`, 6, true);

  let note = '';
  if (displaced) {
    adjustSatisfaction(state, displaced.id, -15);
    adjustLoyalty(state, displaced.id, -10);
    adjustOpinion(state, displaced.id, state.player.personId, -15);
    addLifeEvent(state, displaced.id, 'demoted', `Replaced as lead of ${u.name} by ${fullName(p)} and kept on as staff.`, -5, true);
    ripple(state, displaced.id, -4, -2);
    note = ` ${shortName(displaced)} stays on as staff and will resent it.`;
  }
  resentPassedOver(state, u, [personId, displaced?.id ?? '']);
  ripple(state, personId, 3);
  if (wasLeadOf) addLog(state, `${fullName(p)} left the lead of ${wasLeadOf.name} for ${u.name}; the seat is empty.`, 1, [personId]);
  addLog(state, `Promoted ${fullName(p)} to ${p.title}.`, 2, [personId]);
  return ok(`Promoted ${fullName(p)} to ${p.title}, salary ${formatZuzu(p.salary)}.${note}${skip}`);
}

/** Removes a lead from their seat, leaving them as a member of the same unit. */
export function demote(state: GameState, personId: PersonId): ActionResult {
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  if (!isLead(state, p)) return fail(`${fullName(p)} does not lead anything to be demoted from.`);
  const blocked = spend(state, 'demote');
  if (blocked) return blocked;

  const u = unit(state, p.unitId!);
  const skip = applySkip(state, [chainOfCommand(state, personId)], personId);
  const oldTitle = p.title;
  placeAsMember(state, personId, u.id);
  p.salary = roundTo(p.salary * (1 - DEMOTION_PAY_CUT), 500);
  adjustSatisfaction(state, personId, -20);
  adjustLoyalty(state, personId, -15);
  adjustOpinion(state, personId, state.player.personId, -20);
  addLifeEvent(state, personId, 'demoted', `Demoted from ${oldTitle} to staff, with a pay cut.`, -5, true);
  ripple(state, personId, -4, -2);
  addLog(state, `Demoted ${fullName(p)} from ${oldTitle}.`, 2, [personId]);
  return ok(`Demoted ${fullName(p)} from ${oldTitle}. The seat is open.${skip}`);
}

/** Moves a non-lead person into another unit as a member. */
export function reassign(state: GameState, personId: PersonId, unitId: UnitId): ActionResult {
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  const dest = state.units[unitId];
  if (!dest) return fail('No such unit.');
  if (isLead(state, p)) return fail(`${fullName(p)} leads a unit; demote or promote instead.`);
  if (dest.kind === 'executive') return fail('Not into your own office.');
  if (p.unitId === unitId) return fail(`${fullName(p)} is already in ${dest.name}.`);
  const blocked = spend(state, 'reassign');
  if (blocked) return blocked;

  const from = unit(state, p.unitId!);
  const skip = applySkip(state, [chainOfCommand(state, personId), leadsFromUnit(state, unitId, true)], personId);
  placeAsMember(state, personId, unitId);
  const better = dest.morale >= from.morale;
  adjustSatisfaction(state, personId, better ? 2 : -3);
  addLifeEvent(state, personId, 'reassigned', `Moved from ${from.name} to ${dest.name}.`, better ? 1 : -1, true);
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
    if (!peer || !isActive(peer) || peer.role !== p.role) continue;
    if (!(p.traits.includes('gossip') || peer.traits.includes('gossip'))) continue;
    if (peer.salary >= headline) continue;
    adjustSatisfaction(state, id, -3);
    adjustOpinion(state, id, state.player.personId, -2);
    n++;
  }
  return n;
}

const greedFactor = (p: Person) => 0.5 + p.greed / 100;

export function setSalary(state: GameState, personId: PersonId, salary: number): ActionResult {
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  if (!Number.isFinite(salary) || salary <= 0) return fail('Salary must be a positive amount.');
  salary = Math.round(salary);
  if (salary === p.salary) return fail(`${fullName(p)} already earns that.`);
  const blocked = spend(state, 'setSalary');
  if (blocked) return blocked;

  const skip = applySkip(state, [chainOfCommand(state, personId)], personId);
  const old = p.salary;
  const pct = (salary - old) / old;
  const g = greedFactor(p);
  const sharpness = pct < 0 ? 1.5 : 1;
  p.salary = salary;
  adjustSatisfaction(state, personId, clamp(pct * 100 * 0.8 * g * sharpness, -30, 30));
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
  const p = staffTarget(state, personId);
  if (isFail(p)) return p;
  if (!Number.isFinite(shares) || shares <= 0) return fail('Grant a positive number of shares.');
  shares = Math.floor(shares);
  if (shares < 1) return fail('Grant at least one share.');
  if (shares > state.company.sharesOutstanding * OPTION_GRANT_MAX_FRACTION) return fail('The board would never approve a grant that large.');
  const blocked = spend(state, 'grantOptions');
  if (blocked) return blocked;

  const skip = applySkip(state, [chainOfCommand(state, personId)], personId);
  const value = shares * state.company.sharePrice;
  const ratio = value / Math.max(1, p.salary);
  const g = greedFactor(p);
  p.stockOptions += shares;
  adjustSatisfaction(state, personId, clamp(ratio * 25 * g, 0, 25));
  adjustLoyalty(state, personId, Math.round(clamp(ratio * 12 * g, 0, 15)));
  adjustOpinion(state, personId, state.player.personId, Math.round(clamp(ratio * 10 * g, 0, 15)));
  addLifeEvent(state, personId, 'options', `Granted ${shares.toLocaleString('en-US')} stock options worth ${formatZuzu(value)}.`, clamp(Math.round(ratio * 6), 1, 4), true);
  const grumble = ratio > 0.3 ? grumbling(state, p, p.salary + value) : 0;
  addLog(state, `Granted ${fullName(p)} ${shares} stock options.`, 1, [personId]);
  return ok(`Granted ${fullName(p)} ${shares.toLocaleString('en-US')} options worth ${formatZuzu(value)}.${grumble ? ' Word got around the unit.' : ''}${skip}`);
}

/** Splits the quarter's bonus pool. Amounts in zuzu; unallocated money returns to cash. */
export function allocateBonus(state: GameState, allocations: Record<string, number>): ActionResult {
  const pool = state.company.bonusPool;
  if (!(pool > 0)) return fail('There is no bonus pool to split.');
  let total = 0;
  for (const [id, amount] of Object.entries(allocations)) {
    const p = state.people[id];
    if (!p || !isActive(p) || p.unitId === null) return fail('A bonus was assigned to someone who is not on staff.');
    if (id === state.player.personId) return fail('You cannot pay yourself from the pool.');
    if (!Number.isFinite(amount) || amount < 0) return fail('Bonus amounts must be zero or more.');
    total += amount;
  }
  if (total > pool + 0.5) return fail(`That is ${formatZuzu(total - pool)} more than the pool holds.`);
  const blocked = spend(state, 'allocateBonus');
  if (blocked) return blocked;

  // Who expects a share, and roughly how big.
  const weights = bonusWeights(state);
  const weightSum = sum([...weights.values()]);
  let snubbed = 0;
  for (const [id, w] of weights) {
    const p = person(state, id);
    const fair = (pool * w) / weightSum;
    const got = allocations[id] ?? 0;
    const ratio = got / fair;
    if (ratio >= 1) {
      adjustSatisfaction(state, id, 3);
      adjustLoyalty(state, id, 1);
    } else if (ratio < 0.5) {
      const sting = (1 - ratio) * greedFactor(p);
      adjustSatisfaction(state, id, -Math.round(6 * sting));
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
    adjustSatisfaction(state, id, clamp(frac * 40 * greedFactor(p), 1, 10));
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
  const u = state.units[unitId];
  if (!u) return fail('No such unit.');
  if (!Number.isFinite(budget) || budget < 0) return fail('A budget cannot be negative.');
  budget = Math.round(budget);
  const old = u.budget;
  if (budget === old) return fail('That is already the budget.');
  const blocked = spend(state, 'setBudget');
  if (blocked) return blocked;
  u.budget = budget;
  const lead = u.leadId && u.leadId !== state.player.personId ? state.people[u.leadId] : null;
  if (lead && isActive(lead)) {
    const change = old > 0 ? (budget - old) / old : 0.3;
    const swing = Math.round(clamp(change * 40, -15, 15));
    adjustOpinion(state, lead.id, state.player.personId, swing);
    if (swing !== 0) adjustLoyalty(state, lead.id, Math.round(swing / 3));
  }
  addLog(state, `${u.name} budget set to ${formatZuzu(budget)} a month.`, 1, lead ? [lead.id] : []);
  return ok(`${u.name} budget is now ${formatZuzu(budget)} a month${lead ? ` (was ${formatZuzu(old)}); ${shortName(lead)} noticed` : ''}.`);
}

// ---- Restructuring ----

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
  if (!m || !isActive(m)) return;
  adjustOpinion(state, leadId, state.player.personId, opinion);
  adjustLoyalty(state, leadId, loyalty);
}

function depthOf(state: GameState, id: UnitId): number {
  let d = 0;
  for (let u = unit(state, id); u.parentId; u = unit(state, u.parentId)) d++;
  return d;
}

export function moveUnit(state: GameState, unitId: UnitId, newParentId: UnitId): ActionResult {
  const u = state.units[unitId];
  const parent = state.units[newParentId];
  if (!u || !parent) return fail('No such unit.');
  if (u.id === state.rootUnitId || u.parentId === null) return fail("The CEO's office can't be moved.");
  if (u.parentId === newParentId) return fail(`${u.name} already reports there.`);
  if (unitsUnder(state, unitId).some((x) => x.id === newParentId)) return fail('A unit cannot move under itself.');
  if (!ALLOWED_PARENTS[u.kind].includes(parent.kind)) return fail(`A ${u.kind} cannot sit under a ${parent.kind}.`);
  const blocked = spend(state, 'restructure');
  if (blocked) return blocked;

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
  addLog(state, `Moved ${u.name} from ${oldParent.name} to ${parent.name}.`, 2, lead ? [lead.id] : []);
  return ok(`${u.name} now reports into ${parent.name}.`);
}

/** Folds `absorbId` into `keepId`: members and child units move over, its lead becomes a member. */
export function mergeUnits(state: GameState, keepId: UnitId, absorbId: UnitId): ActionResult {
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
  const blocked = spend(state, 'restructure');
  if (blocked) return blocked;

  const lead = absorb.leadId && absorb.leadId !== state.player.personId ? person(state, absorb.leadId) : null;
  const members = absorb.memberIds.slice();
  const keepLead = keep.leadId;
  if (lead) {
    placeAsMember(state, lead.id, keepId);
    adjustSatisfaction(state, lead.id, -15);
    lowerBy(state, lead.id, -15, -10);
    addLifeEvent(state, lead.id, 'unitMerged', `Lost the lead of ${absorb.name} when it was merged into ${keep.name}.`, -4, true);
  }
  for (const id of members) placeAsMember(state, id, keepId);
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
  addLog(state, `Merged ${absorb.name} into ${keep.name}.`, 2, lead ? [lead.id] : []);
  return ok(`${absorb.name} is now part of ${keep.name}.${lead ? ` ${shortName(lead)} lost ${pronoun(lead, 'possessive')} seat.` : ''}`);
}

/** Creates an empty unit under a parent. */
export function createUnit(
  state: GameState,
  parentId: UnitId,
  kind: Exclude<UnitKind, 'executive' | 'function'> | 'function',
  name: string,
  functionKind?: FunctionKind,
): ActionResult {
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
  const blocked = spend(state, 'restructure');
  if (blocked) return blocked;
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
  addLog(state, `Created ${name} under ${parent.name}.`, 1);
  return ok(`Created ${name} under ${parent.name}. It has no lead yet.`);
}

/** Removes a unit; its people and child units move up to its parent. */
export function dissolveUnit(state: GameState, unitId: UnitId): ActionResult {
  const u = state.units[unitId];
  if (!u) return fail('No such unit.');
  if (u.parentId === null || u.kind === 'executive') return fail("The CEO's office can't be dissolved.");
  if (u.kind === 'division' || u.kind === 'function') return fail(`A ${u.kind} can't be dissolved.`);
  const parent = unit(state, u.parentId);
  for (const c of u.childIds) {
    if (!ALLOWED_PARENTS[unit(state, c).kind].includes(parent.kind)) return fail(`${u.name}'s sub-units can't sit under ${parent.name}.`);
  }
  const blocked = spend(state, 'restructure');
  if (blocked) return blocked;

  const lead = u.leadId && u.leadId !== state.player.personId ? person(state, u.leadId) : null;
  if (lead) {
    placeAsMember(state, lead.id, parent.id);
    adjustSatisfaction(state, lead.id, -15);
    lowerBy(state, lead.id, -15, -10);
    addLifeEvent(state, lead.id, 'unitDissolved', `Lost the lead of ${u.name} when it was dissolved.`, -4, true);
  }
  for (const id of u.memberIds.slice()) placeAsMember(state, id, parent.id);
  for (const c of u.childIds.slice()) {
    unit(state, c).parentId = parent.id;
    parent.childIds.push(c);
  }
  parent.childIds = parent.childIds.filter((c) => c !== unitId);
  parent.budget += u.budget;
  delete state.units[unitId];
  lowerBy(state, parent.leadId, -2, 0);
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

/** Months a suspected plotter stays on the CEO's radar after someone talks. */
const GOSSIP_ATTENTION_MONTHS = 3;

/** Whether `other` is close enough to `p` for p to know what they are up to: same unit, same chain of command, or acquainted. */
function nearTo(state: GameState, p: Person, other: Person): boolean {
  if (p.unitId !== null && other.unitId === p.unitId) return true;
  if (chainOfCommand(state, p.id).includes(other.id) || chainOfCommand(state, other.id).includes(p.id)) return true;
  return !!state.relations[p.id]?.[other.id];
}

/**
 * What a talkative person lets slip about a third party: first any plot they
 * are close to (the CEO now knows of it and the plotter is on the radar), else
 * a secret of someone they are feuding with. Deterministic: lowest id first,
 * no RNG. Returns the clause to add to the result, or null.
 */
function probeGossip(state: GameState, p: Person): string | null {
  // Gossips always talk; most others do about two times in three.
  if (!p.traits.includes('gossip') && !variant([true, true, false], p.id, state.month, 'gossip')) return null;
  const me = state.player.personId;

  const plotterIds = Object.keys(state.plots).sort();
  for (const plotterId of plotterIds) {
    const plot = state.plots[plotterId];
    const plotter = state.people[plotterId];
    const target = state.people[plot.targetId];
    if (plot.known || plotterId === p.id || !plotter || !target || !isActive(plotter) || !isActive(target)) continue;
    const involved = p.id === target.id || nearTo(state, p, plotter) || (target.id !== me && nearTo(state, p, target));
    if (!involved) continue;
    plot.known = true;
    if (!hasAttention(state, plotter)) {
      plotter.attentionUntil = state.month + GOSSIP_ATTENTION_MONTHS;
      plotter.attentionReason = 'Suspected of plotting';
    }
    addLog(state, `${fullName(p)} told the CEO that ${fullName(plotter)} is campaigning against ${target.id === me ? 'the CEO' : fullName(target)}.`, 2, [plotter.id, target.id]);
    return `that ${fullName(plotter)} is campaigning against ${target.id === me ? 'you' : p.id === target.id ? pronoun(p, 'object') : fullName(target)}`;
  }

  const foes = Object.entries(state.relations[p.id] ?? {})
    .filter(([, r]) => r.tag === 'rival' || r.tag === 'grudge')
    .map(([id]) => state.people[id])
    .filter((x): x is Person => !!x && isActive(x) && x.id !== me)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const foe of foes) {
    const secret = foe.secrets.filter((x) => !x.revealed).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (!secret) continue;
    secret.revealed = true;
    addLifeEvent(state, foe.id, 'exposed', `${fullName(p)} gave the CEO a secret in a private meeting: ${secret.description}`, -2, true);
    return `something on ${fullName(foe)}: ${secret.description}`;
  }
  return null;
}

export function meet(state: GameState, personId: PersonId, approach: MeetingApproach, promise?: MeetingPromise): ActionResult {
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

  const blocked = spend(state, 'meet');
  if (blocked) return blocked;
  const skip = applySkip(state, [chainOfCommand(state, personId)], personId, SKIP_MEETING_STRENGTH);

  if (approach === 'rapport') {
    const mod = rapportMod(p);
    const o = Math.max(1, Math.round(6 * charm * mod));
    adjustOpinion(state, personId, me.id, o);
    adjustLoyalty(state, personId, Math.max(0, Math.round(4 * charm * mod)));
    adjustSatisfaction(state, personId, 2);
    const line = reply(p, state.month, approach, o >= 6 ? RAPPORT_WARM : RAPPORT_GUARDED);
    return withScene(ok(`You spent an hour with ${name}. ${capitalize(pronoun(p, 'subject'))} left ${o >= 6 ? 'warmer toward you' : 'a little less guarded'}.${skip}`), p, line);
  }

  if (approach === 'promise') {
    const pr = makePromise(state, personId, promise!.kind, promise!.months, promise!.detail);
    const months = promise!.months;
    adjustLoyalty(state, personId, PROMISE_LOYALTY);
    adjustOpinion(state, personId, me.id, PROMISE_OPINION);
    addLifeEvent(state, personId, 'promised', `The CEO promised ${pronoun(p, 'object')} ${PROMISE_LABEL[pr.kind]}: ${pr.detail}`, 1, true);
    addLog(state, `Promised ${name} ${PROMISE_LABEL[pr.kind]} within ${months} months.`, 1, [personId]);
    return withScene(ok(`${name} took you at your word. It is due in ${months} month${months === 1 ? '' : 's'}.${skip}`), p, reply(p, state.month, approach, PROMISE_REPLY));
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
    let line = reply(p, state.month, approach, THREAT_CALM);
    if ((p.traits.includes('ruthless') || p.traits.includes('vain')) && chance(state, 0.5)) {
      adjustOpinion(state, personId, me.id, -10);
      adjustLoyalty(state, personId, -8);
      state.incidents.push({ kind: 'scheme', personIds: [personId, me.id], unitId: p.unitId });
      extra = ` ${capitalize(pronoun(p, 'subject'))} did not take it quietly.`;
      line = variant(THREAT_DEFIANT, p.id, state.month, approach);
    } else if (p.traits.includes('principled') && chance(state, 0.5) && state.directors.length) {
      const d = pick(state, state.directors);
      adjustOpinion(state, d.personId, me.id, -8);
      state.company.boardConfidence = clamp(state.company.boardConfidence - 3);
      state.incidents.push({ kind: 'complaint', personIds: [personId, bossOf(state, personId) ?? me.id], unitId: p.unitId });
      extra = ` ${capitalize(pronoun(p, 'subject'))} took it to the board.`;
      line = variant(["This is going to the board.", "You'll explain that to the directors, not to me."], p.id, state.month, approach);
    }
    addLog(state, `Threatened ${name}.`, 1, [personId]);
    return withScene(ok(`${name} will keep ${pronoun(p, 'possessive')} head down for now.${loyaltyNote}${extra}${skip}`), p, line);
  }

  // probe
  const odds = clamp(0.5 + (me.skills.guile - p.skills.guile) / 100 - (p.traits.includes('paranoid') ? 0.15 : 0), 0.15, 0.9);
  const learned: string[] = [];
  const talked = chance(state, odds);
  if (talked) {
    p.investigatedMonth = state.month;
    learned.push(`who ${pronoun(p, 'subject')} ${verb(p, 'trust')} and who ${pronoun(p, 'subject')} ${verb(p, 'resent')}`);
    const c = p.cliqueId ? state.cliques[p.cliqueId] : null;
    if (c) {
      c.known = true;
      learned.push(`that ${pronoun(p, 'subject')} ${verb(p, 'run')} with ${c.name}`);
    }
    const hidden = p.secrets.find((s) => !s.revealed);
    if (hidden && chance(state, odds * 0.6)) {
      hidden.revealed = true;
      learned.push(`a secret: ${hidden.description}`);
      addLifeEvent(state, personId, 'exposed', `A private meeting with the CEO drew out a secret: ${hidden.description}`, -2, true);
    }
    const gossip = probeGossip(state, p);
    if (gossip) learned.push(`and ${gossip}`);
  } else if (p.traits.includes('paranoid')) {
    adjustOpinion(state, personId, me.id, -4);
  }
  addLog(state, `Probed ${name}.`, 1, [personId]);
  const line = reply(p, state.month, approach, talked ? PROBE_TALKED : PROBE_CLOSED);
  return withScene(ok(learned.length ? `Probing ${name}, you learned ${learned.join('; ')}.${skip}` : `${name} gave you nothing.${skip}`), p, line);
}

// ---- Security ----

/** The lead of the security function, if the seat is filled. */
function securityHead(state: GameState): Person | null {
  const u = Object.values(state.units).find((x) => x.functionKind === 'security');
  const lead = u?.leadId ? state.people[u.leadId] : null;
  return lead && isActive(lead) ? lead : null;
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
  const p = state.people[personId];
  if (!p || !isActive(p)) return fail('That person is no longer with the company.');
  if (personId === state.player.personId) return fail("You can't investigate yourself.");
  const head = securityHead(state);
  if (!head) return fail('There is no Head of Security to run it.');
  if (head.id === personId) return fail('Security cannot investigate its own head.');

  const blocked = spend(state, 'investigatePerson');
  if (blocked) return blocked;
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
  return ok(`${shortName(head)}'s team found ${body} on ${fullName(p)}.${saw ? ` ${capitalize(pronoun(p, 'subject'))} noticed.` : ''}`);
}

/** Security digs into a unit: reveals feuds, cliques and who really does the work there. */
export function investigateUnit(state: GameState, unitId: UnitId): ActionResult {
  const u = state.units[unitId];
  if (!u) return fail('No such unit.');
  const head = securityHead(state);
  if (!head) return fail('There is no Head of Security to run it.');

  const blocked = spend(state, 'investigateUnit');
  if (blocked) return blocked;
  const ids = peopleUnder(state, unitId).filter((id) => id !== state.player.personId && isActive(person(state, id)));
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
  return ok(`${shortName(head)}'s review of ${u.name} turned up ${parts.join(', ')}.${star ? ` Most of the real work comes from ${fullName(star)}.` : ''}${noticedBy ? ` ${noticedBy} noticed the digging.` : ''}`);
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
  const d = state.people[directorId];
  if (!d || !isActive(d) || !state.directors.some((x) => x.personId === directorId)) return fail('That person is not on the board.');
  const me = state.player.personId;
  const name = fullName(d);
  if (approach === 'favor' && state.player.personalCash < FAVOR_COST) return fail(`A favor costs ${formatZuzu(FAVOR_COST)}; you don't have it.`);
  const blocked = spend(state, 'lobbyDirector');
  if (blocked) return blocked;
  let delta = 0;
  let message: string;
  let line: string;
  const say = (...lines: string[]) => variant(lines, d.id, state.month, approach);

  if (approach === 'persuade') {
    delta = Math.max(1, Math.round(5 * recentPerformance(state) * Math.min(1.3, charmOf(state)) + (d.traits.includes('vain') ? 1 : 0)));
    message = `You walked ${name} through the numbers. ${capitalize(pronoun(d, 'subject'))} ${be(d)} more receptive.`;
    line = reply(d, state.month, approach, DIRECTOR_PERSUADED);
  } else if (approach === 'favor') {
    state.player.personalCash -= FAVOR_COST;
    if (d.traits.includes('principled')) {
      delta = -8;
      message = `${name} took your favor as a bribe and said so.`;
      line = say('Is this meant to be a bribe? Take it back.', 'I am not for sale, and I will say so to the others.');
    } else {
      delta = Math.round(FAVOR_SWING * (0.6 + d.greed / 100));
      message = `${name} accepted your favor, at a cost of ${formatZuzu(FAVOR_COST)}.`;
      line = say("That is generous. I won't forget it.", 'Between us, then. Thank you.');
      addLifeEvent(state, directorId, 'favor', 'Accepted a personal favor from the CEO.', 1, true);
    }
  } else {
    const secret = d.secrets.filter((s) => s.revealed).sort((a, b) => b.severity - a.severity)[0];
    if (secret) {
      delta = 15 + 10 * secret.severity;
      message = `You let ${name} know what you knew. ${capitalize(pronoun(d, 'subject'))} fell in line.`;
      line = say('I understand. We need not discuss it again.', 'You have made your point.');
      addLifeEvent(state, directorId, 'pressured', `Was pressured over ${secret.description}`, -3, true);
    } else {
      delta = PRESSURE_BACKFIRE;
      state.company.boardConfidence = clamp(state.company.boardConfidence - 4);
      message = `${name} had nothing to fear from you and went to the other directors about it.`;
      line = say('Did you really think that would work on me?', 'You have made a serious mistake coming here.');
    }
  }
  adjustOpinion(state, directorId, me, delta);
  if (delta > 0) state.company.boardConfidence = clamp(state.company.boardConfidence + Math.round(delta / 8));
  addLog(state, `Lobbied ${name} (${approach}).`, 2, [directorId]);
  return withScene(ok(message), d, line);
}

/** Announces profit guidance for the current quarter. Only once per quarter. */
export function setGuidance(state: GameState, amount: number): ActionResult {
  if (state.company.guidance !== null) return fail('Guidance for this quarter is already public.');
  if (!Number.isFinite(amount) || amount <= 0) return fail('Guidance must be a positive profit figure.');
  const blocked = spend(state, 'setGuidance');
  if (blocked) return blocked;
  state.company.guidance = Math.round(amount);
  addLog(state, `Announced profit guidance of ${formatZuzu(state.company.guidance)} for the quarter.`, 2);
  return ok(`Guidance set at ${formatZuzu(state.company.guidance)}.`);
}

/** Retire from the company. Ends the game. */
export function retire(state: GameState): ActionResult {
  if (state.gameOver) return fail('The game is over.');
  endGame(state, 'retired');
  return ok('You stepped down as CEO.');
}
