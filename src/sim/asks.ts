// Board asks: each quarter two directors demand something concrete, drawn from
// their agenda, and judge it at the next board meeting. They give the player
// goals, and they conflict on purpose (reform wants personnel changes, the old
// guard wants no purges). Director choice never touches the RNG, so adding
// asks cannot shift a seeded game.
import type { AskKind, BoardAsk, DirectorAgenda, GameState, Month, Person, PersonId } from './types';
import { estimatedMonthlyCosts, estimatedMonthlyRevenue } from './economy';
import { activeDirectors, addLog, adjustOpinion, formatZuzu, fullName, isActive, isQuarterEnd, newId } from './org';
import { clamp, sum } from './util';

// ---- Tuning -------------------------------------------------------------

/** How many directors make a demand each quarter. */
const ASKS_PER_QUARTER = 2;
/** Revenue the growth directors want over last quarter's. */
const REVENUE_TARGET = 1.015;
/** Margin points the dividend directors want on top of last quarter's... */
const MARGIN_STEP = 0.01;
/** ...and the least margin they will ask for. */
const MARGIN_FLOOR = 0.05;
/** Costs the safety directors will tolerate over last quarter's. */
const COST_CEILING = 1.02;
/** Personnel changes the reformers want in a quarter. */
const SHAKEUP_TARGET = 3;
/** Months of service that make someone "old guard". */
const OLD_TENURE_MONTHS = 60;

const MET_OPINION = 10;
const MET_CONFIDENCE = 2;
const MISSED_OPINION = -6;
const MISSED_CONFIDENCE = -2;

/** Asks older than this many months are dropped from the save. */
const KEEP_MONTHS = 36;

/** What each agenda wants, in plain words. */
export const AGENDA_PLAIN: Record<DirectorAgenda, string> = {
  growth: 'wants the company to grow, and wants it fast',
  safety: 'wants the company safe: cash in the bank, no scandals, no empty chairs',
  dividends: 'wants profit paid out, so margins matter above all',
  reform: 'wants the company shaken up and new people in the chairs',
  oldGuard: 'wants the people who built the company protected',
};

const CHANGE_KINDS = new Set(['hired', 'fired', 'promoted', 'demoted', 'reassigned', 'restructure', 'unitMerged', 'unitDissolved']);
const PURGE_KINDS = new Set(['fired', 'demoted']);

export interface AskProgress {
  /** The measured figure so far (a quarter projected from the months booked). */
  value: number;
  target: number;
  /** Whether the ask would be met if judged now. */
  met: boolean;
  /** Short human label, e.g. "1.8Mㄓ of 1.9Mㄓ". */
  label: string;
}

export interface AskResult {
  directorId: PersonId;
  text: string;
  met: boolean;
}

// ---- Measuring ----------------------------------------------------------

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Last quarter's revenue, costs and profit, or an estimate from the divisions before there is any history. */
function lastQuarter(state: GameState): { revenue: number; costs: number; profit: number } {
  const h = state.company.history;
  const recent = h.slice(-3);
  if (recent.length === 0) {
    const revenue = estimatedMonthlyRevenue(state) * 3;
    const costs = estimatedMonthlyCosts(state) * 3;
    return { revenue, costs, profit: revenue - costs };
  }
  const k = 3 / recent.length;
  return {
    revenue: sum(recent.map((r) => r.revenue)) * k,
    costs: sum(recent.map((r) => r.costs)) * k,
    profit: sum(recent.map((r) => r.profit)) * k,
  };
}

/** Division and function lead seats that are empty. */
function vacancies(state: GameState): number {
  let n = 0;
  for (const u of Object.values(state.units)) {
    if (u.kind !== 'division' && u.kind !== 'function') continue;
    const lead = u.leadId ? state.people[u.leadId] : undefined;
    if (!lead || !isActive(lead)) n++;
  }
  return n;
}

/** Distinct people the player reshuffled (or, with `purge`, old hands the player fired or demoted) in the ask's window. */
function personnelCount(state: GameState, ask: BoardAsk, purge: boolean): number {
  let n = 0;
  for (const p of Object.values(state.people)) {
    const hit = p.history.some((e) => {
      if (!e.byPlayer || e.month < ask.madeMonth || e.month > ask.dueMonth) return false;
      if (!purge) return CHANGE_KINDS.has(e.kind);
      return PURGE_KINDS.has(e.kind) && e.month - p.hiredMonth >= OLD_TENURE_MONTHS;
    });
    if (hit) n++;
  }
  return n;
}

/** Quarter figures for the ask's window: the months booked so far, scaled to a quarter. */
function windowFigures(state: GameState, ask: BoardAsk, finalQuarter: boolean) {
  const h = state.company.history;
  const rows = finalQuarter ? h.slice(-3) : h.filter((r) => r.month >= ask.madeMonth && r.month <= ask.dueMonth);
  if (rows.length === 0) return null;
  const k = 3 / rows.length;
  const revenue = sum(rows.map((r) => r.revenue)) * k;
  const profit = sum(rows.map((r) => r.profit)) * k;
  return { revenue, costs: sum(rows.map((r) => r.costs)) * k, margin: revenue > 0 ? profit / revenue : 0 };
}

function measure(state: GameState, ask: BoardAsk, finalQuarter: boolean): AskProgress {
  const target = ask.target;
  const fig = windowFigures(state, ask, finalQuarter);
  switch (ask.kind) {
    case 'revenueGrowth': {
      const value = fig ? fig.revenue : ask.baseline;
      return { value, target, met: value >= target, label: `${formatZuzu(value)} of ${formatZuzu(target)}` };
    }
    case 'margin': {
      const value = fig ? fig.margin : ask.baseline;
      return { value, target, met: value >= target, label: `${pct(value)} of ${pct(target)}` };
    }
    case 'costControl': {
      const value = fig ? fig.costs : ask.baseline;
      return { value, target, met: value <= target, label: `${formatZuzu(value)} (limit ${formatZuzu(target)})` };
    }
    case 'fillSeats': {
      const value = vacancies(state);
      return { value, target, met: value <= target, label: plural(value, 'vacancy', 'vacancies') };
    }
    case 'shakeUp': {
      const value = personnelCount(state, ask, false);
      return { value, target, met: value >= target, label: `${value} of ${target} changes` };
    }
    case 'noPurge': {
      const value = personnelCount(state, ask, true);
      return { value, target, met: value <= target, label: `${plural(value, 'purge', 'purges')} (limit ${target})` };
    }
  }
}

/** How an ask stands right now. Safe on any state: missing directors and empty history just fall back to the baseline. */
export function askProgress(state: GameState, ask: BoardAsk): AskProgress {
  const now = measure(state, ask, false);
  return ask.state === 'open' ? now : { ...now, met: ask.state === 'met' };
}

// ---- Issuing ------------------------------------------------------------

/** The next quarter-end month strictly after `month` (month 0 is followed by month 2). */
function nextDueMonth(month: Month): Month {
  const gap = (2 - (month % 3) + 3) % 3;
  return month + (gap === 0 ? 3 : gap);
}

function buildAsk(state: GameState, d: Person, agenda: DirectorAgenda, madeMonth: Month, dueMonth: Month): BoardAsk {
  const last = lastQuarter(state);
  const base = { id: newId(state, 'ask'), directorId: d.id, madeMonth, dueMonth, state: 'open' as const };
  const make = (kind: AskKind, text: string, target: number, baseline: number): BoardAsk => ({ ...base, kind, text, target, baseline });

  switch (agenda) {
    case 'growth': {
      const target = Math.round((last.revenue * REVENUE_TARGET) / 10_000) * 10_000;
      return make('revenueGrowth', `Grow revenue to at least ${formatZuzu(target)} this quarter (last quarter: ${formatZuzu(last.revenue)}).`, target, last.revenue);
    }
    case 'dividends': {
      const baseline = last.revenue > 0 ? last.profit / last.revenue : 0;
      const target = Math.round(Math.max(MARGIN_FLOOR, baseline + MARGIN_STEP) * 1000) / 1000;
      return make('margin', `Lift the profit margin to at least ${pct(target)} this quarter (last quarter: ${pct(baseline)}).`, target, baseline);
    }
    case 'safety': {
      const empty = vacancies(state);
      if (empty > 0) return make('fillSeats', 'Have every officer and division seat filled by the meeting.', 0, empty);
      const target = Math.round((last.costs * COST_CEILING) / 10_000) * 10_000;
      return make('costControl', `Keep quarterly costs under ${formatZuzu(target)} (last quarter: ${formatZuzu(last.costs)}).`, target, last.costs);
    }
    case 'reform':
      return make('shakeUp', `Make at least ${SHAKEUP_TARGET} personnel changes this quarter.`, SHAKEUP_TARGET, 0);
    case 'oldGuard':
      return make('noPurge', "Don't fire or demote anyone with 5+ years' service.", 0, 0);
  }
}

/**
 * Two directors each make a demand, due at the next quarter-end board
 * meeting. Directors rotate with the quarter so every agenda is heard in turn.
 * Idempotent: if asks are already open for that meeting, nothing is added.
 * Returns the asks open for the coming meeting.
 */
export function issueAsks(state: GameState): BoardAsk[] {
  const dueMonth = nextDueMonth(state.month);
  state.asks = (state.asks ?? []).filter((a) => a.dueMonth >= state.month - KEEP_MONTHS);
  const existing = state.asks.filter((a) => a.state === 'open' && a.dueMonth === dueMonth);
  if (existing.length) return existing;

  const dirs = activeDirectors(state);
  const n = dirs.length;
  if (n === 0) return [];
  // The ask begins when the meeting ends; at game start (or in a save made mid-quarter) it begins now.
  const madeMonth = isQuarterEnd(state.month) ? state.month + 1 : state.month;
  const q = Math.floor(dueMonth / 3);
  const picks: number[] = [];
  for (let k = 0; k < ASKS_PER_QUARTER; k++) {
    const i = (ASKS_PER_QUARTER * q + k) % n;
    if (!picks.includes(i)) picks.push(i);
  }

  const made: BoardAsk[] = [];
  for (const i of picks) {
    const d = dirs[i];
    const agenda = state.directors.find((x) => x.personId === d.id)?.agenda;
    if (!agenda) continue;
    const ask = buildAsk(state, d, agenda, madeMonth, dueMonth);
    state.asks.push(ask);
    made.push(ask);
  }
  return made;
}

// ---- Judging ------------------------------------------------------------

/**
 * Judges the asks due at this board meeting from the quarter just closed.
 * Meeting an ask pleases the director and the board; missing it costs both a
 * little. Asks whose director has left lapse without effect.
 */
export function judgeAsks(state: GameState): AskResult[] {
  const results: AskResult[] = [];
  const ceoId = state.player.personId;
  for (const ask of state.asks ?? []) {
    if (ask.state !== 'open' || ask.dueMonth > state.month) continue;
    const d = state.people[ask.directorId];
    if (!d || !isActive(d)) {
      ask.state = 'missed';
      continue;
    }
    const met = measure(state, ask, true).met;
    ask.state = met ? 'met' : 'missed';
    adjustOpinion(state, d.id, ceoId, met ? MET_OPINION : MISSED_OPINION);
    state.company.boardConfidence = clamp(state.company.boardConfidence + (met ? MET_CONFIDENCE : MISSED_CONFIDENCE));
    addLog(state, `${fullName(d)}'s ask was ${met ? 'met' : 'missed'}: ${ask.text}`, 2, [d.id]);
    results.push({ directorId: d.id, text: ask.text, met });
  }
  return results;
}
