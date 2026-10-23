import { describe, expect, it } from 'vitest';
import { guidanceCredit } from './economy';

describe('guidanceCredit', () => {
  it('earns nothing well below the board’s bar and everything at 102% of it', () => {
    expect(guidanceCredit(900, 1000)).toBe(0);
    expect(guidanceCredit(940, 1000)).toBe(0);
    expect(guidanceCredit(1020, 1000)).toBe(1);
    expect(guidanceCredit(1500, 1000)).toBe(1);
  });

  it('rises in a straight line in between', () => {
    expect(guidanceCredit(980, 1000)).toBeCloseTo(0.5);
    expect(guidanceCredit(1000, 1000)).toBeCloseTo(0.75);
  });

  it('is full when the board has no bar yet', () => {
    expect(guidanceCredit(1, null)).toBe(1);
  });
});
