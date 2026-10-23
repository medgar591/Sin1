// Turns people and units into numbers: performance, unit output, morale,
// division revenue and costs, cash, quarterly earnings, share price.
import type { DivisionStats, GameState, OrgUnit, Person, UnitId } from './types';
import {
  activeStaff,
  addLog,
  clamp,
  formatZuzu,
  getRelation,
  headcount,
  isActive,
  playerPerson,
  quarterLabel,
  unit,
  unitsUnder,
} from './org';
import { gaussian } from './rng';

export interface QuarterResult {
  /** Month that closed the quarter. */
  month: number;
  revenue: number;
  costs: number;
  profit: number;
  /** Guidance announced for the quarter, if any. */
  guidance: number | null;
  /** profit / guidance - 1, or null without guidance. */
  surprise: number | null;
  sharePriceBefore: number;
  sharePriceAfter: number;
  boardConfidenceBefore: number;
  boardConfidenceAfter: number;
}

export interface OutputFactor {
  label: string;
  /** Points added to (or taken from) the 100 baseline. */
  effect: number;
}

// ---- Tuning -------------------------------------------------------------

/** Normal operating budget per head per month, zuzu. */
export const NORMAL_BUDGET_PER_HEAD = 2_000;
/** Company-wide margin the starting base revenue is calibrated to (healthy output). */
export const TARGET_MARGIN = 0.17;

const PERF_SATISFACTION = 0.25;
const PERF_MORALE = 0.2;
const PERF_NOISE = 3;
const PERF_DILIGENT = 6;
const PERF_LAZY = -8;

const LEAD_MANAGEMENT = 0.5;
const LEAD_WORK = 0.3;
const MORALE_WEIGHT = 0.3;
const REL_NEGATIVE = 0.25;
const REL_POSITIVE = 0.08;
const FEUD_PER_PAIR = 4;
const FEUD_CAP = 20;
const FEUD_OPINION = -40;
const STARVE_MAX = 40;
const OVERFUND_MAX = 10;
const EMPTY_LEAD_PENALTY = 25;

const MORALE_DRIFT = 0.2;
/** Share of positive lead/morale/budget effects kept at levels that have sub-units (avoids stacking). */
const UPPER_BONUS_SHARE = 0.5;

const GROWTH_BASE = 0.003;
const GROWTH_PER_OUTPUT = 0.0003;
const GROWTH_DRIFT = 0.1;
const GROWTH_MIN = -0.01;
const GROWTH_MAX = 0.015;

const NEGATIVE_CASH_CONFIDENCE_HIT = 1.5;

const BEAT_PRICE = 0.5;
const BEAT_PRICE_CAP = 0.08;
const MISS_PRICE = 1.2;
const MISS_PRICE_CAP = 0.2;
const NO_GUIDANCE_PRICE = -0.02;
const TREND_PRICE = 0.03;
const TREND_PRICE_CAP = 0.04;
const PRICE_NOISE = 0.02;

/** Extra per-division bookkeeping; stays plain JSON on the DivisionStats object. */
type DivisionBook = DivisionStats & { baseRevenue?: number; growthIndex?: number };

// ---- Unit output --------------------------------------------------------

/** Active people who work directly in this unit (lead plus members). */
function directPeople(state: GameState, u: OrgUnit): Person[] {
  const ids = u.leadId ? [u.leadId, ...u.memberIds] : u.memberIds;
  return ids.map((id) => state.people[id]).filter((p): p is Person => !!p && isActive(p));
}

/** People who report straight into this unit's lead: its members and its child units' leads. */
function reportsOf(state: GameState, u: OrgUnit): Person[] {
  const out = u.memberIds.map((id) => state.people[id]).filter((p): p is Person => !!p && isActive(p));
  for (const cid of u.childIds) {
    const lid = state.units[cid]?.leadId;
    const p = lid ? state.people[lid] : undefined;
    if (p && isActive(p)) out.push(p);
  }
  return out;
}

function unitHeadcount(state: GameState, u: OrgUnit): number {
  return unitsUnder(state, u.id).reduce((n, x) => n + directPeople(state, x).length, 0);
}

function avg(values: number[], fallback = 0): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
}

/** Each person's performance, 0–100. */
function personPerformance(state: GameState, p: Person): number {
  const morale = p.unitId ? (state.units[p.unitId]?.morale ?? 50) : 50;
  let perf = p.skills.work + (p.satisfaction - 50) * PERF_SATISFACTION + (morale - 50) * PERF_MORALE;
  if (p.traits.includes('diligent')) perf += PERF_DILIGENT;
  if (p.traits.includes('lazy')) perf += PERF_LAZY;
  perf += gaussian(state) * PERF_NOISE;
  return clamp(perf);
}

/** Number of feuding pairs (rival/grudge with deeply negative opinion) in a group. */
function feudPairs(state: GameState, group: Person[]): number {
  let pairs = 0;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = getRelation(state, group[i].id, group[j].id);
      const b = getRelation(state, group[j].id, group[i].id);
      const feud = (r: typeof a) => r && (r.tag === 'rival' || r.tag === 'grudge') && r.opinion <= FEUD_OPINION;
      if (feud(a) || feud(b)) pairs++;
    }
  }
  return pairs;
}

/** Budget effect: starving hurts hard, overfunding has diminishing returns. */
function budgetEffect(ratio: number): number {
  if (ratio < 1) return -(1 - ratio) * STARVE_MAX;
  return OVERFUND_MAX * (1 - Math.exp(-(ratio - 1)));
}

/** Breaks a unit's output into a base and the factors that move it. */
function unitFactors(state: GameState, u: OrgUnit): { base: number; factors: OutputFactor[] } {
  const factors: OutputFactor[] = [];
  const lead = u.leadId ? state.people[u.leadId] : undefined;
  const leadOk = !!lead && isActive(lead);

  // Base: headcount-weighted mix of members' performance (50 -> 100) and sub-unit outputs.
  const members = u.memberIds.map((id) => state.people[id]).filter((p): p is Person => !!p && isActive(p));
  let weight = members.length;
  let sum = members.reduce((a, p) => a + p.performance * 2, 0);
  for (const cid of u.childIds) {
    const c = state.units[cid];
    if (!c) continue;
    const w = unitHeadcount(state, c);
    weight += w;
    sum += c.output * w;
  }
  const base = weight > 0 ? sum / weight : leadOk ? lead!.performance * 2 : 50;

  if (leadOk) {
    const mg = (lead!.skills.management - 50) * LEAD_MANAGEMENT;
    const wk = (lead!.skills.work - 50) * LEAD_WORK;
    factors.push({ label: 'Lead management', effect: mg });
    factors.push({ label: 'Lead work skill', effect: wk });
  } else {
    factors.push({ label: 'Empty lead seat', effect: -EMPTY_LEAD_PENALTY });
  }

  factors.push({ label: 'Morale', effect: (u.morale - 50) * MORALE_WEIGHT });

  if (leadOk) {
    const reports = reportsOf(state, u).filter((p) => p.id !== lead!.id);
    const ops: number[] = [];
    for (const r of reports) {
      ops.push(getRelation(state, lead!.id, r.id)?.opinion ?? 0);
      ops.push(getRelation(state, r.id, lead!.id)?.opinion ?? 0);
    }
    const o = avg(ops);
    factors.push({ label: 'Lead and reports relations', effect: o < 0 ? o * REL_NEGATIVE : o * REL_POSITIVE });
    const group = [lead!, ...reports];
    const pairs = feudPairs(state, group);
    if (pairs > 0) factors.push({ label: `Infighting (${pairs} feud${pairs > 1 ? 's' : ''})`, effect: -Math.min(FEUD_CAP, pairs * FEUD_PER_PAIR) });
  }

  const heads = Math.max(1, directPeople(state, u).length);
  const ratio = u.budget / (heads * NORMAL_BUDGET_PER_HEAD);
  const be = budgetEffect(ratio);
  if (Math.abs(be) >= 0.05) factors.push({ label: be < 0 ? 'Budget starved' : 'Budget generous', effect: be });

  // Sub-units already carry their own bonuses, so upper levels keep the full
  // penalties (a bad manager drags everything) but only part of the bonuses.
  if (u.childIds.length > 0) {
    for (const f of factors) if (f.effect > 0) f.effect *= UPPER_BONUS_SHARE;
  }

  return { base, factors };
}

function outputOf(base: number, factors: OutputFactor[]): number {
  return clamp(base + factors.reduce((a, f) => a + f.effect, 0), 0, 200);
}

/** Short list of what is pushing a unit's output up or down. First entry is the base. */
export function explainUnitOutput(state: GameState, unitId: UnitId): OutputFactor[] {
  const u = unit(state, unitId);
  const { base, factors } = unitFactors(state, u);
  const label = u.childIds.length > 0 ? 'Staff and sub-units' : 'Staff performance';
  return [{ label, effect: base - 100 }, ...factors.filter((f) => Math.abs(f.effect) >= 0.5)].map((f) => ({
    label: f.label,
    effect: Math.round(f.effect * 10) / 10,
  }));
}

/** Units ordered children-first. */
function postOrder(state: GameState): OrgUnit[] {
  const pre: OrgUnit[] = [];
  const stack = [state.rootUnitId];
  while (stack.length) {
    const u = state.units[stack.pop()!];
    if (!u) continue;
    pre.push(u);
    stack.push(...u.childIds);
  }
  return pre.reverse();
}

/** Recomputes every person's performance and every unit's output and morale drift. */
export function computeOutputs(state: GameState): void {
  for (const p of activeStaff(state)) p.performance = Math.round(personPerformance(state, p) * 10) / 10;

  for (const u of postOrder(state)) {
    const { base, factors } = unitFactors(state, u);
    u.output = Math.round(outputOf(base, factors) * 10) / 10;

    // Morale drifts toward a target rather than jumping.
    const staff = directPeople(state, u);
    const lead = u.leadId ? state.people[u.leadId] : undefined;
    const target =
      50 +
      (avg(staff.map((p) => p.satisfaction), 50) - 50) * 0.6 +
      (lead && isActive(lead) ? (lead.skills.management - 50) * 0.3 : -10) +
      (u.output - 100) * 0.2;
    u.morale = clamp(u.morale + (clamp(target) - u.morale) * MORALE_DRIFT);
  }
}

// ---- Money --------------------------------------------------------------

/** Monthly salaries of a single unit's own people (lead and members), not its children. */
function ownSalaries(state: GameState, u: OrgUnit): number {
  return directPeople(state, u).reduce((a, p) => a + p.salary / 12, 0);
}

/** Monthly cost of a unit and everything under it (salaries + budgets). */
export function unitMonthlyCost(state: GameState, unitId: UnitId): number {
  return unitsUnder(state, unitId).reduce((a, u) => a + ownSalaries(state, u) + u.budget, 0);
}

/** Monthly cost of the root and function units, leaving the divisions out. */
function overheadCost(state: GameState): number {
  let total = 0;
  const stack = [state.rootUnitId];
  while (stack.length) {
    const u = state.units[stack.pop()!];
    if (!u) continue;
    if (state.divisions[u.id]) continue;
    total += ownSalaries(state, u) + u.budget;
    stack.push(...u.childIds);
  }
  return total;
}

/** Monthly financials: division revenue and costs, cash, monthly history record. */
export function runEconomyMonth(state: GameState): void {
  const divs = Object.values(state.divisions) as DivisionBook[];
  const costs = new Map<UnitId, number>();
  for (const d of divs) costs.set(d.unitId, unitMonthlyCost(state, d.unitId));
  const overhead = overheadCost(state);
  const divTotal = [...costs.values()].reduce((a, b) => a + b, 0);

  let revenue = 0;
  let totalCosts = overhead;
  for (const d of divs) {
    const u = unit(state, d.unitId);
    const c = costs.get(d.unitId) ?? 0;
    if (d.baseRevenue === undefined) {
      // Calibrate on first run: overhead is shared by cost, so the whole company clears the target margin.
      const share = divTotal > 0 ? (overhead * c) / divTotal : 0;
      // Divide out the starting output so the company opens at the target margin.
      d.baseRevenue = (c + share) / (1 - TARGET_MARGIN) / (clamp(u.output, 60, 160) / 100);
      d.growthIndex = 1;
    }
    const targetGrowth = clamp(GROWTH_BASE + (u.output - 100) * GROWTH_PER_OUTPUT, GROWTH_MIN, GROWTH_MAX);
    d.growth = clamp(d.growth + (targetGrowth - d.growth) * GROWTH_DRIFT, GROWTH_MIN, GROWTH_MAX);
    d.growthIndex = (d.growthIndex ?? 1) * (1 + d.growth);
    d.revenue = Math.round(d.baseRevenue * (u.output / 100) * d.market * d.growthIndex);
    d.costs = Math.round(c);
    revenue += d.revenue;
    totalCosts += c;
  }
  totalCosts = Math.round(totalCosts);
  const profit = revenue - totalCosts;
  state.company.cash += profit;

  // The CEO draws a salary from the company.
  const ceo = playerPerson(state);
  state.player.personalCash += ceo.salary / 12;

  if (state.company.cash < 0) {
    state.company.boardConfidence = clamp(state.company.boardConfidence - NEGATIVE_CASH_CONFIDENCE_HIT);
  }

  state.company.history.push({
    month: state.month,
    cash: state.company.cash,
    revenue,
    costs: totalCosts,
    profit,
    sharePrice: state.company.sharePrice,
    boardConfidence: state.company.boardConfidence,
    headcount: headcount(state),
  });
}

// ---- Quarters -----------------------------------------------------------

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Closes the quarter that ends this month: sums profit, judges it against
 * guidance, moves share price and board confidence, sets the bonus pool, and
 * clears guidance for the next quarter.
 */
export function closeQuarter(state: GameState): QuarterResult {
  const co = state.company;
  const hist = co.history;
  const recent = hist.slice(-3);
  const prior = hist.slice(-6, -3);
  const revenue = sum(recent.map((r) => r.revenue));
  const costs = sum(recent.map((r) => r.costs));
  const profit = sum(recent.map((r) => r.profit));
  const guidance = co.guidance;
  const priceBefore = co.sharePrice;
  const confBefore = co.boardConfidence;

  let surprise: number | null = null;
  let priceMove = 0;
  let confMove = 0;
  if (guidance !== null) {
    surprise = (profit - guidance) / Math.max(Math.abs(guidance), 500_000);
    if (surprise >= 0) {
      priceMove = Math.min(BEAT_PRICE_CAP, surprise * BEAT_PRICE);
      confMove = Math.min(7, 2 + surprise * 15);
    } else {
      priceMove = Math.max(-MISS_PRICE_CAP, surprise * MISS_PRICE);
      confMove = Math.max(-18, -4 + surprise * 30);
    }
  } else {
    priceMove = NO_GUIDANCE_PRICE;
    confMove = -2;
  }
  if (prior.length === 3) {
    const prev = sum(prior.map((r) => r.profit));
    const trend = (profit - prev) / Math.max(Math.abs(prev), 1_000_000);
    priceMove += clamp(trend * TREND_PRICE, -TREND_PRICE_CAP, TREND_PRICE_CAP);
  }
  priceMove += gaussian(state) * PRICE_NOISE;
  if (co.cash < 0) confMove -= 4;

  co.sharePrice = Math.max(1, Math.round(priceBefore * (1 + priceMove) * 100) / 100);
  co.boardConfidence = clamp(confBefore + confMove);

  // Bonus pool: a share of profit, richer when guidance is beaten, thin on a miss.
  let share = 0;
  let why: string;
  if (profit <= 0) why = 'no profit, no pool';
  else if (surprise !== null && surprise >= 0) {
    share = 0.18;
    why = 'guidance beaten, 18% of profit';
  } else if (surprise !== null) {
    share = 0.05;
    why = 'guidance missed, 5% of profit';
  } else {
    share = 0.1;
    why = 'no guidance given, 10% of profit';
  }
  co.bonusPool = Math.round(Math.max(0, profit) * share);
  co.guidance = null;

  const g = guidance === null ? 'no guidance' : `guidance ${formatZuzu(guidance)}`;
  addLog(
    state,
    `${quarterLabel(state.month)} closed: profit ${formatZuzu(profit)} against ${g}. Share price ${formatZuzu(priceBefore)} to ${formatZuzu(co.sharePrice)}; board confidence ${Math.round(confBefore)} to ${Math.round(co.boardConfidence)}.`,
    3,
  );
  addLog(state, `Bonus pool ${formatZuzu(co.bonusPool)}: ${why}.`, 2);

  return {
    month: state.month,
    revenue,
    costs,
    profit,
    guidance,
    surprise,
    sharePriceBefore: priceBefore,
    sharePriceAfter: co.sharePrice,
    boardConfidenceBefore: confBefore,
    boardConfidenceAfter: co.boardConfidence,
  };
}

/** Estimated monthly profit when there is no history yet. */
function estimatedMonthlyProfit(state: GameState): number {
  const divs = Object.values(state.divisions);
  return sum(divs.map((d) => d.revenue - d.costs)) - overheadCost(state);
}

/** A reasonable profit guidance for the coming quarter, as a default for the UI. */
export function suggestedGuidance(state: GameState): number {
  const recent = state.company.history.slice(-3);
  const monthly = recent.length ? sum(recent.map((r) => r.profit)) / recent.length : estimatedMonthlyProfit(state);
  // Slightly cautious: shave 5% off a positive run-rate (or widen a loss).
  const target = monthly * 3 * (monthly >= 0 ? 0.95 : 1.05);
  return Math.round(target / 50_000) * 50_000;
}
