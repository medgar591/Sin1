// The end of a game: score, and the people whose lives the player changed most.
import type { GameOverReason, GameState, LifeEvent, PersonId } from './types';

export interface EpilogueEntry {
  personId: PersonId;
  name: string;
  /** Title they held when it mattered most, or at the end. */
  title: string;
  /** Sum of impacts from the player's own decisions. */
  impact: number;
  /** Events caused by the player, oldest first. */
  events: LifeEvent[];
  /** A short paragraph telling their story under the player, and where they ended up. */
  story: string;
}

export function computeScore(_state: GameState): number {
  throw new Error('computeScore: not implemented');
}

/** Ends the game: sets state.gameOver with score and summary. */
export function endGame(_state: GameState, _reason: GameOverReason): void {
  throw new Error('endGame: not implemented');
}

/** Up to `limit` people the player affected most, split between helped and harmed. */
export function buildEpilogue(_state: GameState, _limit?: number): { helped: EpilogueEntry[]; harmed: EpilogueEntry[] } {
  throw new Error('buildEpilogue: not implemented');
}
