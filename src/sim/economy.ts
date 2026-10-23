// Turns people and units into numbers: performance, unit output, morale,
// division revenue and costs, cash, quarterly earnings, share price.
import type { GameState, UnitId } from './types';

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

/** Recomputes every person's performance and every unit's output and morale drift. */
export function computeOutputs(_state: GameState): void {
  throw new Error('computeOutputs: not implemented');
}

/** Monthly financials: division revenue and costs, cash, monthly history record. */
export function runEconomyMonth(_state: GameState): void {
  throw new Error('runEconomyMonth: not implemented');
}

/**
 * Closes the quarter that ends this month: sums profit, judges it against
 * guidance, moves share price and board confidence, sets the bonus pool, and
 * clears guidance for the next quarter.
 */
export function closeQuarter(_state: GameState): QuarterResult {
  throw new Error('closeQuarter: not implemented');
}

/** A reasonable profit guidance for the coming quarter, as a default for the UI. */
export function suggestedGuidance(_state: GameState): number {
  throw new Error('suggestedGuidance: not implemented');
}

/** Monthly cost of a unit and everything under it (salaries + budgets). */
export function unitMonthlyCost(_state: GameState, _unitId: UnitId): number {
  throw new Error('unitMonthlyCost: not implemented');
}
