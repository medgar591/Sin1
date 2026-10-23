import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./epilogue', () => ({ endGame: vi.fn() }));
import { smallCompany } from './testkit';
import { askProgress, issueAsks, judgeAsks } from './asks';
import { runBoardMeeting } from './board';
import { opinionOf } from './org';
import type { QuarterResult } from './economy';
import { endGame } from './epilogue';
import type { AskKind, BoardAsk, GameState } from './types';

beforeEach(() => vi.mocked(endGame).mockClear());

function addHistory(state: GameState, rows: { month: number; revenue: number; costs: number }[]) {
  for (const r of rows) {
    state.company.history.push({ month: r.month, cash: 0, revenue: r.revenue, costs: r.costs, profit: r.revenue - r.costs, sharePrice: 40, boardConfidence: 60, headcount: 10 });
  }
}


function ask(state: GameState, directorId: string, kind: AskKind, over: Partial<BoardAsk> = {}): BoardAsk {
  const a: BoardAsk = {
    id: `a${state.asks.length}`,
    directorId,
    kind,
    text: `ask ${kind}`,
    target: 0,
    baseline: 0,
    madeMonth: 0,
    dueMonth: 2,
    state: 'open',
    ...over,
  };
  state.asks.push(a);
  return a;
}

describe('issueAsks', () => {
  it('at game start picks two distinct directors due at the first quarter end', () => {
    const f = smallCompany();
    const made = issueAsks(f.state);
    expect(made).toHaveLength(2);
    expect(f.state.asks).toHaveLength(2);
    expect(new Set(made.map((a) => a.directorId)).size).toBe(2);
    expect(made.every((a) => a.dueMonth === 2 && a.madeMonth === 0 && a.state === 'open')).toBe(true);
    // Rotation for q=0: the first two directors (growth, safety).
    expect(made.map((a) => a.directorId)).toEqual([f.directors[0].id, f.directors[1].id]);
    expect(made[0].kind).toBe('revenueGrowth');
    // Safety with no vacancy asks for cost control.
    expect(made[1].kind).toBe('costControl');
    expect(made[0].baseline).toBeGreaterThan(0);
    expect(made[0].target).toBeGreaterThan(made[0].baseline);
  });

  it('at a quarter end looks three months ahead and rotates directors', () => {
    const f = smallCompany();
    f.state.month = 5;
    addHistory(f.state, [3, 4, 5].map((month) => ({ month, revenue: 3_000_000, costs: 2_400_000 })));
    const made = issueAsks(f.state);
    expect(made.every((a) => a.dueMonth === 8 && a.madeMonth === 6)).toBe(true);
    // q=2 of 3 directors: indices 1 and 2 (safety, dividends).
    expect(made.map((a) => a.directorId)).toEqual([f.directors[1].id, f.directors[2].id]);
    expect(made[1].kind).toBe('margin');
    expect(made[1].baseline).toBeCloseTo(0.2);
    expect(made[1].target).toBeCloseTo(0.21);
    // Asking again before the meeting adds nothing.
    expect(issueAsks(f.state)).toHaveLength(2);
    expect(f.state.asks).toHaveLength(2);
  });

  it('safety asks for filled seats when a seat is vacant', () => {
    const f = smallCompany();
    f.finance.leadId = null;
    f.cfo.unitId = null;
    const made = issueAsks(f.state);
    expect(made[1].kind).toBe('fillSeats');
    expect(made[1].baseline).toBe(1);
  });

  it('works with a one-director board and an empty one', () => {
    const f = smallCompany();
    f.state.directors = f.state.directors.slice(0, 1);
    expect(issueAsks(f.state)).toHaveLength(1);
    const g = smallCompany();
    g.state.directors = [];
    expect(issueAsks(g.state)).toEqual([]);
  });

  it('does not touch the RNG', () => {
    const f = smallCompany();
    const before = f.state.rngState;
    issueAsks(f.state);
    expect(f.state.rngState).toBe(before);
  });
});

describe('askProgress and judgeAsks', () => {
  it('revenueGrowth projects the quarter from the months booked', () => {
    const f = smallCompany();
    const a = ask(f.state, f.directors[0].id, 'revenueGrowth', { target: 9_500_000, baseline: 9_000_000 });
    expect(askProgress(f.state, a)).toMatchObject({ value: 9_000_000, met: false });
    addHistory(f.state, [{ month: 0, revenue: 3_300_000, costs: 2_000_000 }]);
    const p = askProgress(f.state, a);
    expect(p.value).toBeCloseTo(9_900_000);
    expect(p.met).toBe(true);
    expect(p.label).toBe('9.9Mㄓ of 9.5Mㄓ');
  });

  it('judges revenueGrowth met and missed with opinion and confidence effects', () => {
    for (const [revenue, met] of [[3_300_000, true], [3_000_000, false]] as const) {
      const f = smallCompany();
      f.state.month = 2;
      f.state.company.boardConfidence = 50;
      addHistory(f.state, [0, 1, 2].map((month) => ({ month, revenue, costs: 2_000_000 })));
      ask(f.state, f.directors[0].id, 'revenueGrowth', { target: 9_500_000, baseline: 9_000_000 });
      const results = judgeAsks(f.state);
      expect(results).toEqual([{ directorId: f.directors[0].id, text: 'ask revenueGrowth', met }]);
      expect(f.state.asks[0].state).toBe(met ? 'met' : 'missed');
      expect(opinionOf(f.state, f.directors[0].id, f.ceo.id)).toBe(met ? 10 : -6);
      expect(f.state.company.boardConfidence).toBe(met ? 52 : 48);
      expect(f.state.log.some((l) => l.text.includes(met ? 'was met' : 'was missed'))).toBe(true);
      // Judged only once.
      expect(judgeAsks(f.state)).toEqual([]);
    }
  });

  it('margin compares profit over revenue', () => {
    const f = smallCompany();
    f.state.month = 2;
    addHistory(f.state, [0, 1, 2].map((month) => ({ month, revenue: 3_000_000, costs: 2_700_000 })));
    const a = ask(f.state, f.directors[2].id, 'margin', { target: 0.11, baseline: 0.08 });
    expect(askProgress(f.state, a)).toMatchObject({ met: false, label: '10.0% of 11.0%' });
    a.target = 0.09;
    expect(askProgress(f.state, a).met).toBe(true);
    expect(judgeAsks(f.state)[0].met).toBe(true);
  });

  it('costControl is a ceiling', () => {
    const f = smallCompany();
    f.state.month = 2;
    addHistory(f.state, [0, 1, 2].map((month) => ({ month, revenue: 3_000_000, costs: 2_500_000 })));
    const a = ask(f.state, f.directors[1].id, 'costControl', { target: 7_400_000, baseline: 7_200_000 });
    expect(askProgress(f.state, a)).toMatchObject({ value: 7_500_000, met: false });
    a.target = 7_600_000;
    expect(askProgress(f.state, a)).toMatchObject({ met: true, label: '7.5Mㄓ (limit 7.6Mㄓ)' });
  });

  it('fillSeats counts empty division and function seats', () => {
    const f = smallCompany();
    f.state.month = 2;
    const a = ask(f.state, f.directors[1].id, 'fillSeats', { target: 0, baseline: 1 });
    expect(askProgress(f.state, a)).toMatchObject({ value: 0, met: true, label: '0 vacancies' });
    f.finance.leadId = null;
    expect(askProgress(f.state, a)).toMatchObject({ value: 1, met: false, label: '1 vacancy' });
    f.cfo.status = 'fired';
    f.finance.leadId = f.cfo.id;
    expect(askProgress(f.state, a).value).toBe(1);
    expect(judgeAsks(f.state)[0].met).toBe(false);
  });

  it('shakeUp counts distinct people changed by the player in the window', () => {
    const f = smallCompany();
    f.state.month = 2;
    const a = ask(f.state, f.directors[0].id, 'shakeUp', { target: 3, madeMonth: 1 });
    const ev = (kind: string, month: number, byPlayer = true) => ({ month, kind, text: kind, impact: 0, byPlayer });
    f.workers[0].history.push(ev('hired', 1), ev('promoted', 2));
    f.workers[1].history.push(ev('reassigned', 2));
    f.workers[2].history.push(ev('fired', 0), ev('raise', 2), ev('hired', 2, false));
    expect(askProgress(f.state, a)).toMatchObject({ value: 2, met: false, label: '2 of 3 changes' });
    f.lead.history.push(ev('unitMerged', 2));
    expect(askProgress(f.state, a)).toMatchObject({ value: 3, met: true });
    expect(judgeAsks(f.state)[0].met).toBe(true);
  });

  it('noPurge only counts firing or demoting people with five years of service', () => {
    const f = smallCompany();
    f.state.month = 2;
    const a = ask(f.state, f.directors[0].id, 'noPurge', { target: 0 });
    const ev = (kind: string, byPlayer = true) => ({ month: 1, kind, text: kind, impact: 0, byPlayer });
    f.workers[0].hiredMonth = -10;
    f.workers[0].history.push(ev('fired'));
    f.workers[1].hiredMonth = -80;
    f.workers[1].history.push(ev('fired', false));
    f.workers[2].hiredMonth = -80;
    f.workers[2].history.push(ev('promoted'));
    expect(askProgress(f.state, a)).toMatchObject({ value: 0, met: true, label: '0 purges (limit 0)' });
    f.lead.hiredMonth = -61;
    f.lead.history.push(ev('demoted'));
    expect(askProgress(f.state, a)).toMatchObject({ value: 1, met: false, label: '1 purge (limit 0)' });
    expect(judgeAsks(f.state)[0].met).toBe(false);
  });

  it('never throws on a missing director or an empty history', () => {
    const f = smallCompany();
    const kinds: AskKind[] = ['revenueGrowth', 'margin', 'fillSeats', 'costControl', 'shakeUp', 'noPurge'];
    for (const k of kinds) {
      const a = ask(f.state, 'nobody', k, { target: 1, baseline: 1 });
      expect(() => askProgress(f.state, a)).not.toThrow();
    }
    f.state.month = 2;
    expect(judgeAsks(f.state)).toEqual([]);
    expect(f.state.asks.every((a) => a.state === 'missed')).toBe(true);
  });

  it('reports a judged ask by its verdict', () => {
    const f = smallCompany();
    const a = ask(f.state, f.directors[0].id, 'shakeUp', { target: 3, state: 'met' });
    expect(askProgress(f.state, a).met).toBe(true);
  });
});

describe('runBoardMeeting with asks', () => {
  const quarter: QuarterResult = {
    month: 2,
    revenue: 9_900_000,
    costs: 6_000_000,
    profit: 3_900_000,
    guidance: 3_500_000,
    surprise: 0.1,
    sharePriceBefore: 40,
    sharePriceAfter: 41,
    boardConfidenceBefore: 60,
    boardConfidenceAfter: 62,
  };

  it('judges the open asks, stores them on the meeting and issues the next quarter', () => {
    const f = smallCompany();
    issueAsks(f.state);
    f.state.month = 2;
    addHistory(f.state, [0, 1, 2].map((month) => ({ month, revenue: 3_300_000, costs: 2_000_000 })));
    const meeting = runBoardMeeting(f.state, quarter);
    expect(meeting.asks).toHaveLength(2);
    expect(meeting.asks!.map((a) => a.directorId)).toEqual([f.directors[0].id, f.directors[1].id]);
    expect(meeting.summary).toContain("Directors' asks:");
    const open = f.state.asks.filter((a) => a.state === 'open');
    expect(open).toHaveLength(2);
    expect(open.every((a) => a.dueMonth === 5 && a.madeMonth === 3)).toBe(true);
    expect(f.state.asks.filter((a) => a.state !== 'open')).toHaveLength(2);
  });

  it('issues asks on the first meeting of a save that had none', () => {
    const f = smallCompany();
    f.state.month = 5;
    const meeting = runBoardMeeting(f.state, { ...quarter, month: 5 });
    expect(meeting.asks).toBeUndefined();
    expect(f.state.asks.filter((a) => a.state === 'open' && a.dueMonth === 8)).toHaveLength(2);
  });
});
