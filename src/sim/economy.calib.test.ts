import { describe, expect, it } from 'vitest';
import { generateGame } from './generate';
import { closeQuarter, computeOutputs, runEconomyMonth } from './economy';

describe('calibration with generated company', () => {
  it('starts with roughly 2-4M quarterly profit', () => {
    const profits: number[] = [];
    const outs: number[] = [];
    for (const seed of [1, 2, 3]) {
      const s = generateGame(seed, { companyName: 'X', playerFirstName: 'A', playerLastName: 'B', playerPronouns: 'they' } as never);
      for (let i = 0; i < 3; i++) { computeOutputs(s); runEconomyMonth(s); s.month++; }
      const q = closeQuarter(s);
      profits.push(q.profit);
      outs.push(...Object.keys(s.divisions).map((d) => s.units[d].output));
    }
    console.log('profits', profits, 'div outputs', outs);
    for (const p of profits) { expect(p).toBeGreaterThan(1_500_000); expect(p).toBeLessThan(4_500_000); }
  });
});
