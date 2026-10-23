import { describe, expect, it } from 'vitest';
import { smallCompany } from './testkit';
import { quarterOutlook } from './economy';
import type { GameState } from './types';

function book(state: GameState, months: number[], profit: number) {
  for (const month of months) {
    state.company.history.push({ month, cash: 0, revenue: profit * 4, costs: profit * 3, profit, sharePrice: 40, boardConfidence: 60, headcount: 10 });
  }
}

describe('quarterOutlook', () => {
  it('at the start of the game estimates from the divisions and has nothing booked', () => {
    const { state } = smallCompany();
    const o = quarterOutlook(state);
    expect(o).toMatchObject({ label: 'Q1 2090', monthsIn: 0, monthsLeft: 3, profitSoFar: 0, guidance: null, boardMonth: 2 });
    expect(Number.isFinite(o.projected)).toBe(true);
    expect(() => quarterOutlook({ ...state, units: {}, divisions: {} })).not.toThrow();
  });

  it('mid-quarter adds the run-rate to what is booked and finds the board bar from earlier quarters', () => {
    const { state } = smallCompany();
    book(state, [0, 1, 2], 1_000_000);
    book(state, [3, 4], 1_200_000);
    state.month = 5;
    state.company.guidance = 3_300_000;
    const o = quarterOutlook(state);
    expect(o).toMatchObject({ label: 'Q2 2090', monthsIn: 2, monthsLeft: 1, profitSoFar: 2_400_000, projected: 3_600_000, guidance: 3_300_000, boardMonth: 5 });
    // The bar is last quarter's 3.0M less a point.
    expect(o.expectation).toBeCloseTo(2_970_000);
  });

  it('counts the month being played and uses the last quarter as the run-rate at a quarter start', () => {
    const { state } = smallCompany();
    book(state, [0, 1, 2], 900_000);
    state.month = 3;
    const o = quarterOutlook(state);
    expect(o).toMatchObject({ monthsIn: 0, monthsLeft: 3, profitSoFar: 0, projected: 2_700_000, boardMonth: 5 });
  });
});
