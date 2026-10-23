// The board of directors: their stance on the CEO, quarterly meetings,
// motions and votes, including the no-confidence vote that ends the game.
import type { BoardMeeting, GameState, PersonId } from './types';
import type { QuarterResult } from './economy';

/** -100..100: how firmly this director backs the CEO right now. */
export function directorSupport(_state: GameState, _directorId: PersonId): number {
  throw new Error('directorSupport: not implemented');
}

/**
 * Holds the quarterly board meeting after closeQuarter. Directors react to the
 * quarter, raise motions and vote. A passed no-confidence vote calls
 * endGame(state, 'ousted') from epilogue.ts. Pushes and returns the meeting.
 */
export function runBoardMeeting(_state: GameState, _quarter: QuarterResult): BoardMeeting {
  throw new Error('runBoardMeeting: not implemented');
}
