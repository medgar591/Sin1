// Campaigns by ambitious staff against their boss. npc.ts runs them each
// month; the player's actions, inbox choices and the board read and hit them.
import type { GameState, PersonId } from './types';

/** Progress marks (0-100) at which a plot passes a stage and may be noticed. */
export const PLOT_STAGES = [40, 75];

/** Progress (0-100) of the plot this person is running against their boss, if any. */
export function plotProgress(state: GameState, personId: PersonId): number | null {
  return state.plots[personId]?.progress ?? null;
}

/** The person's campaign loses `amount` progress; at zero it is over. Returns true if a plot was hit. */
export function setbackPlot(state: GameState, personId: PersonId, amount: number): boolean {
  const plot = state.plots[personId];
  if (!plot) return false;
  plot.progress -= amount;
  if (plot.progress <= 0) delete state.plots[personId];
  else plot.stage = PLOT_STAGES.filter((th) => th <= plot.progress).length;
  return true;
}

/** Ends the person's campaign outright (caught, won over, or frightened off). */
export function endPlot(state: GameState, personId: PersonId): boolean {
  if (!state.plots[personId]) return false;
  delete state.plots[personId];
  return true;
}
