// Turns people and units into numbers: performance, unit output, morale,
// division revenue and costs, cash, quarterly earnings, share price.
import type { GameState, OrgUnit, Person, UnitId } from './types';
import {
  activeStaff,
  addLog,
  formatZuzu,
  headcount,
  isActive,
  opinionOf,
  playerPerson,
  quarterLabel,
  unit,
  unitsUnder,
} from './org';
import { gaussian } from './rng';
import { average, clamp, sum } from './util';

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
  /** What the board expected the quarter to deliver, if it had a bar. */
  expectation?: number | null;
  /** Dividend paid out of excess cash this quarter. */
  dividend?: number;
}

export interface OutputFactor {
  label: string;
  /** Points added to (or taken from) the 100 baseline. */
  effect: number;
}

// ---- Tuning -------------------------------------------------------------

/** Normal operating budget per head per month, zuzu. */
export const NORMAL_BUDGET_PER_HEAD = 2_000;

/** Normal budget per head in a given month: it inflates every January along with unit budgets. */
export function normalBudgetPerHead(month: number): number {
  return NORMAL_BUDGET_PER_HEAD * Math.pow(1 + BUDGET_INFLATION, Math.floor(Math.max(0, month) / 12));
}
/** Company-wide margin the starting revenue scale is calibrated to (healthy output). */
const TARGET_MARGIN = 0.17;

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
/** Morale target loses this much: without attention (pay, bonuses, good bosses) units drift down. */
const MORALE_ENTROPY = 2;
/** Output points lost per recent leaver, per head of the unit (see churnPenalty). */
const CHURN_POINTS = 8;
const CHURN_CAP = 14;
/** Share of recent churn that remains each month. */
const CHURN_DECAY = 0.9;
/** Yearly inflation of unit budgets (finance rolls them up every January). */
export const BUDGET_INFLATION = 0.035;
/** Share of positive lead/morale/budget effects kept at levels that have sub-units (avoids stacking). */
const UPPER_BONUS_SHARE = 0.5;

const GROWTH_BASE = 0.0023;
const GROWTH_PER_OUTPUT = 0.00007;
const GROWTH_DRIFT = 0.1;
const GROWTH_MIN = -0.01;
const GROWTH_MAX = 0.015;

/** Demand multipliers are kept between these. */
export const MARKET_MIN = 0.7;
export const MARKET_MAX = 1.4;

const NEGATIVE_CASH_CONFIDENCE_HIT = 1.5;

const BEAT_PRICE = 0.4;
const BEAT_PRICE_CAP = 0.06;
const MISS_PRICE = 1.2;
const MISS_PRICE_CAP = 0.2;
const NO_GUIDANCE_PRICE = -0.03;
const TREND_PRICE = 0.03;
const TREND_PRICE_CAP = 0.04;
const PRICE_NOISE = 0.035;
/** The share price is pulled toward trailing-year profit per share times this multiple. */
export const PRICE_EARNINGS_MULTIPLE = 42;
/** Share of the log gap to fair value closed each quarter, and the most it can move the price. */
const PRICE_PULL = 0.3;
const PRICE_PULL_CAP = 0.12;

// Board expectations: the bar rises with past performance.
/** The board expects profit to beat the same quarter a year ago by this much... */
export const EXPECT_YOY = 0.06;
/** ...and never to fall short of the previous quarter by more than this. */
export const EXPECT_QOQ = -0.01;
/** Guidance below this share of the board's expectation is sandbagging and earns no credit... */
const SANDBAG_FLOOR = 0.94;
/** ...and full credit needs guidance at this share of expectation. */
const SANDBAG_FULL = 1.02;
const BEAT_CONF_BASE = 1.5;
const BEAT_CONF_SLOPE = 12;
const BEAT_CONF_CAP = 5;
/** Confidence change per unit of profit shortfall/excess against the board's own expectation. */
const EXPECT_CONF_SLOPE = 16;
const EXPECT_CONF_MIN = -4.5;
const EXPECT_CONF_MAX = 2;
/** Confidence closes this share of its gap to 50 every quarter. */
export const CONFIDENCE_REVERSION = 0.1;

/** In the first year, bad quarters hurt only this share as much (the board is still sizing you up). */
const NEW_CEO_MONTHS = 12;
const NEW_CEO_SLACK = 0.6;
/** In a recession, bad quarters cost this share of their usual confidence hit. */
const DOWNTURN_FORGIVENESS = 0.6;

// Dividend policy: cash above the reserve is paid out.
export const RESERVE_MONTHS = 4;
export const DIVIDEND_PAYOUT = 0.5;

/** True while a business-cycle downturn is on (a boom is not one). */
export function isDownturn(state: GameState): boolean {
  return !!state.macro && state.macro.depth > 0 && state.month < state.macro.until;
}

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
      const a = state.relations[group[i].id]?.[group[j].id];
      const b = state.relations[group[j].id]?.[group[i].id];
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

/** Output lost to people recently leaving the unit; fades over a few months. */
function churnPenalty(state: GameState, u: OrgUnit): number {
  const c = state.unitChurn[u.id] ?? 0;
  if (c <= 0) return 0;
  const heads = Math.max(4, directPeople(state, u).length);
  return Math.min(CHURN_CAP, (c * CHURN_POINTS) / heads);
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

  const churn = churnPenalty(state, u);
  if (churn >= 0.5) factors.push({ label: 'Recent departures', effect: -churn });

  if (leadOk) {
    const reports = reportsOf(state, u).filter((p) => p.id !== lead!.id);
    const ops: number[] = [];
    for (const r of reports) {
      ops.push(opinionOf(state, lead!.id, r.id), opinionOf(state, r.id, lead!.id));
    }
    const o = average(ops);
    factors.push({ label: 'Lead and reports relations', effect: o < 0 ? o * REL_NEGATIVE : o * REL_POSITIVE });
    const group = [lead!, ...reports];
    const pairs = feudPairs(state, group);
    if (pairs > 0) factors.push({ label: `Infighting (${pairs} feud${pairs > 1 ? 's' : ''})`, effect: -Math.min(FEUD_CAP, pairs * FEUD_PER_PAIR) });
  }

  const heads = Math.max(1, directPeople(state, u).length);
  const ratio = u.budget / (heads * normalBudgetPerHead(state.month));
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
    if (state.unitChurn[u.id] !== undefined) {
      state.unitChurn[u.id] *= CHURN_DECAY;
      if (state.unitChurn[u.id] < 0.05) delete state.unitChurn[u.id];
    }
    u.output = Math.round(outputOf(base, factors) * 10) / 10;

    // Morale drifts toward a target rather than jumping.
    const staff = directPeople(state, u);
    const lead = u.leadId ? state.people[u.leadId] : undefined;
    const target =
      50 -
      MORALE_ENTROPY +
      (average(staff.map((p) => p.satisfaction), 50) - 50) * 0.6 +
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

/**
 * Opens the books on the first month: sets each division's revenue scale so
 * that, with overhead shared out by cost, the whole company clears the target
 * margin at its first month's output.
 */
function calibrateDivisions(state: GameState): void {
  const divs = Object.values(state.divisions);
  const overhead = overheadCost(state);
  const divTotal = sum(divs.map((d) => unitMonthlyCost(state, d.unitId)));
  for (const d of divs) {
    const c = unitMonthlyCost(state, d.unitId);
    const share = divTotal > 0 ? (overhead * c) / divTotal : 0;
    d.scale = (c + share) / (1 - TARGET_MARGIN) / (clamp(unit(state, d.unitId).output, 60, 160) / 100);
  }
}

/** Monthly financials: division revenue and costs, cash, monthly history record. */
export function runEconomyMonth(state: GameState): void {
  if (state.month > 0 && state.month % 12 === 0) {
    // Yearly roll-up: finance marks every unit budget up for inflation.
    for (const u of Object.values(state.units)) u.budget = Math.round((u.budget * (1 + BUDGET_INFLATION)) / 10) * 10;
    addLog(state, `Budgets marked up ${(BUDGET_INFLATION * 100).toFixed(1)}% for the new year; market salaries are rising too.`, 1);
  }
  const divs = Object.values(state.divisions);
  if (divs.some((d) => d.scale === 0)) calibrateDivisions(state);
  let revenue = 0;
  let totalCosts = overheadCost(state);
  for (const d of divs) {
    const u = unit(state, d.unitId);
    const c = unitMonthlyCost(state, d.unitId);
    const targetGrowth = clamp(GROWTH_BASE + (u.output - 100) * GROWTH_PER_OUTPUT, GROWTH_MIN, GROWTH_MAX);
    d.growth = clamp(d.growth + (targetGrowth - d.growth) * GROWTH_DRIFT, GROWTH_MIN, GROWTH_MAX);
    d.scale *= 1 + d.growth;
    d.revenue = Math.round(d.scale * (u.output / 100) * d.market);
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

/**
 * The quarterly profit the board expects, given the history up to the start of
 * the quarter. It ratchets with past performance: growth on the same quarter a
 * year ago, and no slipping back from the last quarter. Null before there is
 * anything to measure against.
 */
export function boardExpectation(state: GameState, history = state.company.history): number | null {
  const q = (from: number, to: number): number | null => {
    const part = history.slice(from, to);
    return part.length === 3 ? sum(part.map((r) => r.profit)) : null;
  };
  const last = q(-3, history.length);
  if (last === null) {
    const est = estimatedMonthlyProfit(state) * 3;
    return est > 0 ? est : null;
  }
  const lastYear = q(-12, -9);
  let bar = last > 0 ? last * (1 + EXPECT_QOQ) : last;
  if (lastYear !== null && lastYear > 0) bar = Math.max(bar, lastYear * (1 + EXPECT_YOY));
  return bar > 0 ? bar : null;
}

/** Trailing-year profit per share times the earnings multiple: where the market thinks the price belongs. */
export function fairSharePrice(state: GameState): number {
  const h = state.company.history.slice(-12);
  const annual = h.length ? (sum(h.map((r) => r.profit)) * 12) / h.length : 0;
  return Math.max(1, (annual / state.company.sharesOutstanding) * PRICE_EARNINGS_MULTIPLE);
}

/**
 * Closes the quarter that ends this month: sums profit, judges it against
 * guidance and the board's own expectation, moves share price and board
 * confidence, pays the dividend, sets the bonus pool, and clears guidance for
 * the next quarter.
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
  const expectation = boardExpectation(state, hist.slice(0, -3));

  let surprise: number | null = null;
  let priceMove = 0;
  let confMove = 0;
  if (guidance !== null) {
    surprise = (profit - guidance) / Math.max(Math.abs(guidance), 500_000);
    // Guidance far below what the board already expects is sandbagging: beating it earns little.
    const credit =
      expectation === null ? 1 : clamp((guidance / expectation - SANDBAG_FLOOR) / (SANDBAG_FULL - SANDBAG_FLOOR), 0, 1);
    if (surprise >= 0) {
      priceMove = Math.min(BEAT_PRICE_CAP, surprise * BEAT_PRICE) * credit;
      confMove = credit * Math.min(BEAT_CONF_CAP, BEAT_CONF_BASE + surprise * BEAT_CONF_SLOPE);
    } else {
      priceMove = Math.max(-MISS_PRICE_CAP, surprise * MISS_PRICE);
      confMove = Math.max(-14, -3 + surprise * 22);
    }
  } else {
    priceMove = NO_GUIDANCE_PRICE;
    confMove = -3;
  }
  if (expectation !== null) {
    // The board also measures you against its own bar, whatever you told the market.
    const gap = (profit - expectation) / Math.max(expectation, 500_000);
    confMove += clamp(gap * EXPECT_CONF_SLOPE, EXPECT_CONF_MIN, EXPECT_CONF_MAX);
  }
  // Everyone is hurting in a downturn: the board marks bad quarters down less harshly.
  if (isDownturn(state) && confMove < 0) confMove *= DOWNTURN_FORGIVENESS;
  if (prior.length === 3) {
    const prev = sum(prior.map((r) => r.profit));
    const trend = (profit - prev) / Math.max(Math.abs(prev), 1_000_000);
    priceMove += clamp(trend * TREND_PRICE, -TREND_PRICE_CAP, TREND_PRICE_CAP);
  }
  // The price drifts toward what the trailing earnings are worth.
  priceMove += clamp(Math.log(fairSharePrice(state) / priceBefore) * PRICE_PULL, -PRICE_PULL_CAP, PRICE_PULL_CAP);
  priceMove += gaussian(state) * PRICE_NOISE;
  if (co.cash < 0) confMove -= 4;
  // A new CEO gets a little slack in the first year.
  if (state.month < NEW_CEO_MONTHS && confMove < 0) confMove *= NEW_CEO_SLACK;

  co.sharePrice = Math.max(1, Math.round(priceBefore * (1 + priceMove) * 100) / 100);
  // Confidence is never permanent: it relaxes toward neutral between results.
  co.boardConfidence = clamp(confBefore + confMove + (50 - confBefore) * CONFIDENCE_REVERSION);

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
  // The pool is set aside from cash; an unspent pool from last quarter goes back first.
  co.cash += co.bonusPool;
  co.bonusPool = Math.round(Math.max(0, profit) * share);
  co.cash -= co.bonusPool;
  co.guidance = null;

  // Dividend policy: the board sweeps cash above the reserve out to shareholders.
  const monthlyCosts = recent.length ? costs / recent.length : 0;
  const reserve = monthlyCosts * RESERVE_MONTHS;
  const dividend = co.cash > reserve ? Math.round(((co.cash - reserve) * DIVIDEND_PAYOUT) / 10_000) * 10_000 : 0;
  if (dividend > 0) {
    co.cash -= dividend;
    state.player.personalCash += (dividend * state.player.shares) / Math.max(1, co.sharesOutstanding);
  }

  const g = guidance === null ? 'no guidance' : `guidance ${formatZuzu(guidance)}`;
  addLog(
    state,
    `${quarterLabel(state.month)} closed: profit ${formatZuzu(profit)} against ${g}. Share price ${formatZuzu(priceBefore)} to ${formatZuzu(co.sharePrice)}; board confidence ${Math.round(confBefore)} to ${Math.round(co.boardConfidence)}.`,
    3,
  );
  addLog(state, `Bonus pool ${formatZuzu(co.bonusPool)}: ${why}.`, 2);
  if (dividend > 0) addLog(state, `Dividend of ${formatZuzu(dividend)} paid out of cash above the ${formatZuzu(reserve)} reserve.`, 2);

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
    expectation,
    dividend,
  };
}

/** Estimated monthly profit when there is no history yet. */
function estimatedMonthlyProfit(state: GameState): number {
  const divs = Object.values(state.divisions);
  return sum(divs.map((d) => d.revenue - d.costs)) - overheadCost(state);
}

/** The default guidance is the run-rate less this much caution. */
const SUGGEST_CAUTION = 0.97;

/**
 * A reasonable profit guidance for the coming quarter, as a default for the UI:
 * a little under the run-rate. It is safe, but it ignores the bar the board has
 * set (see boardExpectation), so it only earns credit while the company is
 * growing fast enough on its own; a CEO who wants the board's applause has to
 * guide at, or past, what the board expects.
 */
export function suggestedGuidance(state: GameState): number {
  const recent = state.company.history.slice(-3);
  const monthly = recent.length ? sum(recent.map((r) => r.profit)) / recent.length : estimatedMonthlyProfit(state);
  const target = monthly * 3 * (monthly >= 0 ? SUGGEST_CAUTION : 2 - SUGGEST_CAUTION);
  return Math.round(target / 50_000) * 50_000;
}
