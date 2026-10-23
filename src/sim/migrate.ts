import type { GameState } from './types';

/** Fills fields added since older saves were written. Identity until a migration is needed. */
export function migrateState(state: GameState): GameState {
  return state;
}
