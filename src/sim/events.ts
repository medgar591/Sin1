// The inbox: turns incidents and world news into decisions for the player,
// and applies the consequences of the option chosen.
import type { ActionResult, GameState } from './types';

/** Consumes state.incidents and adds world news; creates inbox items. Clears incidents. */
export function generateEvents(_state: GameState): void {
  throw new Error('generateEvents: not implemented');
}

/** Applies the player's choice for an inbox item. Costs the option's attention. */
export function resolveInboxItem(_state: GameState, _itemId: string, _optionId: string): ActionResult {
  throw new Error('resolveInboxItem: not implemented');
}

/** Auto-resolves unresolved items whose expiresMonth has passed, using their first option. */
export function expireInbox(_state: GameState): void {
  throw new Error('expireInbox: not implemented');
}
