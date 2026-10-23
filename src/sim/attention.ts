// The player's monthly attention budget: what each action costs and the one
// place it is spent.
import type { ActionResult, GameState, PersonId } from './types';
import { fail } from './util';

export const ATTENTION_COST = {
  hire: 1,
  fire: 1,
  promote: 1,
  demote: 1,
  reassign: 1,
  setSalary: 0,
  grantOptions: 0,
  setBudget: 0,
  restructure: 1,
  meet: 1,
  investigatePerson: 1,
  investigateUnit: 1,
  lobbyDirector: 1,
  fixer: 1,
  setGuidance: 0,
  allocateBonus: 0,
} as const;

export type AttentionAction = keyof typeof ATTENTION_COST;

/** Firing an officer takes the CEO's full attention and the board notices. */
export const OFFICER_FIRE_ATTENTION = 2;

/** Attention an action costs. Firing an officer costs more than firing anyone else. */
export function attentionCost(state: GameState, action: AttentionAction, targetId?: PersonId): number {
  if (action === 'fire' && targetId && state.people[targetId]?.role === 'officer') return OFFICER_FIRE_ATTENTION;
  return ATTENTION_COST[action];
}

/** Spends attention if the game is live and the player can afford it. Returns the failure otherwise. */
export function trySpend(state: GameState, cost: number): ActionResult | null {
  if (state.gameOver) return fail('The game is over.');
  const left = state.player.attentionLeft;
  if (left < cost) return fail(left <= 0 ? 'No attention left this month.' : `Needs ${cost} attention; you have ${left}.`);
  state.player.attentionLeft = left - cost;
  return null;
}
