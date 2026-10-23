// Fixer requests: a stripped-down Sinless run. The player asks for scarce
// materials, a special hire extracted from elsewhere, or dirt on someone,
// sets a budget and whether it must be clean, and gets a report later.
import type { ActionResult, FixerKind, GameState, PersonId, UnitId } from './types';

export interface FixerRequest {
  kind: FixerKind;
  targetUnitId: UnitId | null;
  targetPersonId: PersonId | null;
  budget: number;
  clean: boolean;
}

export interface FixerQuote {
  /** Minimum sensible budget. */
  minBudget: number;
  /** 0..1 at the requested budget. */
  successChance: number;
  /** Months until the report comes back. */
  months: number;
  /** 0..1 chance it traces back to the company if it goes wrong. */
  blowbackRisk: number;
}

export function quoteFixerJob(_state: GameState, _request: FixerRequest): FixerQuote {
  throw new Error('quoteFixerJob: not implemented');
}

/** Pays the budget from company cash, spends attention, and queues the job. */
export function startFixerJob(_state: GameState, _request: FixerRequest): ActionResult {
  throw new Error('startFixerJob: not implemented');
}

/** Resolves jobs due this month: applies results, writes the report, logs, may raise incidents. */
export function resolveFixerJobs(_state: GameState): void {
  throw new Error('resolveFixerJobs: not implemented');
}
