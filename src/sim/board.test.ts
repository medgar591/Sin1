import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./epilogue', () => ({ endGame: vi.fn() }));
import { endGame } from './epilogue';
import { smallCompany, makePerson } from './testkit';
import { directorSupport, runBoardMeeting } from './board';
import { adjustOpinion } from './org';
import type { QuarterResult } from './economy';

const quarter = (over: Partial<QuarterResult> = {}): QuarterResult => ({
  month: 14,
  revenue: 10_000_000,
  costs: 8_000_000,
  profit: 2_000_000,
  guidance: 2_000_000,
  surprise: 0,
  sharePriceBefore: 40,
  sharePriceAfter: 40,
  boardConfidenceBefore: 60,
  boardConfidenceAfter: 60,
  ...over,
});

function fixture(seed = 3) {
  const f = smallCompany(seed);
  f.state.month = 14;
  for (const d of f.directors) adjustOpinion(f.state, d.id, f.ceo.id, 20);
  return f;
}

beforeEach(() => vi.mocked(endGame).mockClear());

describe('directorSupport', () => {
  it('follows opinion and board confidence', () => {
    const f = fixture();
    const hi = directorSupport(f.state, f.directors[1].id);
    adjustOpinion(f.state, f.directors[1].id, f.ceo.id, -80);
    const lo = directorSupport(f.state, f.directors[1].id);
    expect(lo).toBeLessThan(hi - 20);
    f.state.company.boardConfidence = 10;
    expect(directorSupport(f.state, f.directors[1].id)).toBeLessThan(lo);
  });
});

describe('runBoardMeeting', () => {
  it('commends a strong quarter and does not oust a happy CEO', () => {
    const f = fixture();
    const meeting = runBoardMeeting(f.state, quarter({ surprise: 0.2, profit: 2_400_000, boardConfidenceAfter: 66 }));
    expect(meeting.motions.some((m) => m.kind === 'commend' && m.passed)).toBe(true);
    expect(meeting.motions.some((m) => m.kind === 'noConfidence')).toBe(false);
    expect(f.state.boardMeetings).toHaveLength(1);
    expect(endGame).not.toHaveBeenCalled();
  });

  it('weak quarter targets the worst division with a budget cut', () => {
    const f = fixture();
    f.state.company.boardConfidence = 50;
    f.state.divisions[f.division.id].revenue = 1_000_000;
    f.state.divisions[f.division.id].costs = 2_000_000;
    const before = f.team.budget;
    const meeting = runBoardMeeting(f.state, quarter({ surprise: -0.2, profit: -1, boardConfidenceAfter: 50, boardConfidenceBefore: 58 }));
    const cut = meeting.motions.find((m) => m.kind === 'cutBudget')!;
    expect(cut.targetId).toBe(f.division.id);
    if (cut.passed) expect(f.team.budget).toBeLessThan(before);
  });

  it('removes a failing officer and leaves the seat empty', () => {
    const f = fixture();
    f.finance.output = 40;
    for (const d of f.directors) adjustOpinion(f.state, d.id, f.cfo.id, -30);
    const meeting = runBoardMeeting(f.state, quarter());
    const m = meeting.motions.find((x) => x.kind === 'replaceOfficer')!;
    expect(m).toBeDefined();
    expect(m.passed).toBe(true);
    expect(f.cfo.status).toBe('fired');
    expect(f.finance.leadId).toBeNull();
    expect(f.cfo.history.some((h) => h.kind === 'fired' && !h.byPlayer)).toBe(true);
  });

  it('a bad board state raises and passes no-confidence, ending the game', () => {
    const f = fixture();
    f.state.company.boardConfidence = 15;
    for (const d of f.directors) adjustOpinion(f.state, d.id, f.ceo.id, -70);
    const meeting = runBoardMeeting(f.state, quarter({ surprise: -0.3, profit: 1_000_000, boardConfidenceAfter: 15, boardConfidenceBefore: 30 }));
    const m = meeting.motions.find((x) => x.kind === 'noConfidence')!;
    expect(m.passed).toBe(true);
    expect(endGame).toHaveBeenCalledWith(f.state, 'ousted');
  });

  it('an unchecked plotter with allies on the board can topple a healthy CEO', () => {
    const f = fixture();
    f.state.company.boardConfidence = 55;
    // Add two more directors so the board is five strong.
    for (let i = 0; i < 2; i++) {
      const d = makePerson(f.state, 'director');
      f.state.directors.push({ personId: d.id, agenda: 'reform' });
      adjustOpinion(f.state, d.id, f.ceo.id, 0);
    }
    const plotter = makePerson(f.state, 'officer', { unitId: f.finance.id, ambition: 90, loyalty: 10 });
    for (const d of f.state.directors.slice(0, 3)) {
      adjustOpinion(f.state, d.personId, plotter.id, 80);
      adjustOpinion(f.state, d.personId, f.ceo.id, -40);
    }
    runBoardMeeting(f.state, quarter({ boardConfidenceAfter: 55, boardConfidenceBefore: 55 }));
    expect(endGame).toHaveBeenCalled();
  });

  it('a CEO who beats guidance and keeps directors sweet survives a plotter', () => {
    const f = fixture();
    f.state.company.boardConfidence = 75;
    for (let i = 0; i < 2; i++) {
      const d = makePerson(f.state, 'director');
      f.state.directors.push({ personId: d.id, agenda: 'growth' });
    }
    for (const d of f.state.directors) adjustOpinion(f.state, d.personId, f.ceo.id, 40);
    const plotter = makePerson(f.state, 'officer', { unitId: f.finance.id, ambition: 90, loyalty: 10 });
    for (const d of f.state.directors.slice(0, 2)) adjustOpinion(f.state, d.personId, plotter.id, 50);
    runBoardMeeting(f.state, quarter({ surprise: 0.1, boardConfidenceAfter: 75, boardConfidenceBefore: 70 }));
    expect(endGame).not.toHaveBeenCalled();
  });

  it('is deterministic', () => {
    const a = fixture();
    const b = fixture();
    runBoardMeeting(a.state, quarter({ surprise: -0.1 }));
    runBoardMeeting(b.state, quarter({ surprise: -0.1 }));
    expect(a.state).toEqual(b.state);
  });
});
