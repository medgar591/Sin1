// Advances the game one month. The order matters: people act, the numbers
// follow from what they did, then the player gets the fallout in the inbox.
import type { GameState } from './types';
import { computeOutputs, runEconomyMonth, closeQuarter } from './economy';
import { runNpcMonth } from './npc';
import { expireInbox, generateEvents } from './events';
import { resolveFixerJobs } from './fixer';
import { checkPromises } from './promises';
import { runBoardMeeting } from './board';
import { isQuarterEnd } from './org';

export function advanceMonth(state: GameState): void {
  if (state.gameOver) return;

  expireInbox(state);
  runNpcMonth(state);
  computeOutputs(state);
  runEconomyMonth(state);
  resolveFixerJobs(state);
  checkPromises(state);

  if (isQuarterEnd(state.month)) {
    const quarter = closeQuarter(state);
    runBoardMeeting(state, quarter);
    if (state.gameOver) return;
  }

  state.month += 1;
  state.player.attentionLeft = state.player.attentionPerMonth;
  generateEvents(state);
}
