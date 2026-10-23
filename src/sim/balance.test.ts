// Balance harness: three bots play 60 months on several seeds and a summary
// table is printed. Targets are asserted loosely so regressions show up.
//
//  - passive:   announces suggested guidance, takes every inbox item's first
//               option, nothing else. Should get ousted on at least half the seeds.
//  - random:    suggested guidance, splits the bonus pool, random inbox options.
//  - attentive: spends its 3 attention a month sensibly (see attentiveTurn).
import { describe, expect, it } from 'vitest';
import { generateGame } from './generate';
import { advanceMonth } from './turn';
import { headcount } from './org';
import { newMemory, takeTurn, type Bot } from './bots';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MONTHS = 60;

interface Outcome {
  seed: number;
  monthEnded: number;
  ousted: boolean;
  confMin: number;
  confAvg: number;
  confEnd: number;
  /** Share price at the handover, which the end price is measured against. */
  priceStart: number;
  priceEnd: number;
  cashEnd: number;
  staffEnd: number;
  staffMin: number;
  staffMax: number;
  inboxPerMonth: number;
  quits: number;
  fires: number;
  motionsFailed: number;
}

// ---- runner ------------------------------------------------------------

function play(seed: number, bot: Bot, months = MONTHS): Outcome {
  const state = generateGame(seed, { companyName: 'Balance Combine', playerFirstName: 'Ana', playerLastName: 'Reyes', playerPronouns: 'they' });
  const mem = newMemory();
  const confs: number[] = [];
  let items = 0;
  let staffMin = headcount(state);
  let staffMax = staffMin;
  for (let i = 0; i < months && !state.gameOver; i++) {
    items += takeTurn(bot, state, mem);
    advanceMonth(state);
    confs.push(state.company.boardConfidence);
    const h = headcount(state);
    staffMin = Math.min(staffMin, h);
    staffMax = Math.max(staffMax, h);
  }
  const people = Object.values(state.people);
  const ran = Math.max(1, state.month);
  return {
    seed,
    monthEnded: state.month,
    ousted: state.gameOver?.reason === 'ousted',
    confMin: Math.min(...confs),
    confAvg: sum(confs) / confs.length,
    confEnd: state.company.boardConfidence,
    priceStart: state.prequel?.sharePrice ?? 40,
    priceEnd: state.company.sharePrice,
    cashEnd: state.company.cash,
    staffEnd: headcount(state),
    staffMin,
    staffMax,
    inboxPerMonth: items / ran,
    // Leavers on the player's watch only: the years before the handover left people behind too.
    quits: people.filter((p) => (p.status === 'quit' || p.status === 'defected') && (p.leftMonth ?? -1) >= 0).length,
    fires: people.filter((p) => p.status === 'fired' && (p.leftMonth ?? -1) >= 0).length,
    motionsFailed: state.boardMeetings.flatMap((m) => m.motions).filter((m) => m.kind === 'noConfidence' && !m.passed).length,
  };
}

function table(bot: Bot, rows: Outcome[]): string {
  const f = (n: number, d = 0) => n.toFixed(d);
  const head = 'seed  month ousted  conf min/avg/end   price   cash(M)  staff(end,min-max)  inbox/mo  quits fires closeCalls';
  const lines = rows.map(
    (r) =>
      `${String(r.seed).padStart(4)}  ${String(r.monthEnded).padStart(5)} ${(r.ousted ? 'YES' : 'no').padStart(6)}  ` +
      `${f(r.confMin).padStart(3)}/${f(r.confAvg).padStart(3)}/${f(r.confEnd).padStart(3)}      ` +
      `${f(r.priceEnd, 1).padStart(6)}  ${f(r.cashEnd / 1e6, 1).padStart(7)}  ` +
      `${String(r.staffEnd).padStart(4)} ${String(r.staffMin).padStart(4)}-${String(r.staffMax).padEnd(4)}     ` +
      `${f(r.inboxPerMonth, 1).padStart(6)}  ${String(r.quits).padStart(5)} ${String(r.fires).padStart(5)} ${String(r.motionsFailed).padStart(5)}`,
  );
  const ousted = rows.filter((r) => r.ousted);
  const mean = (k: (r: Outcome) => number) => sum(rows.map(k)) / rows.length;
  const foot =
    `-- ${bot}: ousted ${ousted.length}/${rows.length}` +
    (ousted.length ? ` (months ${ousted.map((r) => r.monthEnded).join(',')})` : '') +
    `; mean conf avg ${f(mean((r) => r.confAvg))}, price ${f(mean((r) => r.priceEnd), 1)}, cash ${f(mean((r) => r.cashEnd) / 1e6, 1)}M, ` +
    `inbox/mo ${f(mean((r) => r.inboxPerMonth), 1)}, quits ${f(mean((r) => r.quits), 1)}, fires ${f(mean((r) => r.fires), 1)}`;
  return [`\n== ${bot} bot, ${MONTHS} months ==`, head, ...lines, foot].join('\n');
}

const results: Record<Bot, Outcome[]> = { passive: [], random: [], attentive: [] };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (rows: Outcome[], k: (r: Outcome) => number) => sum(rows.map(k)) / rows.length;

describe('balance', () => {
  for (const bot of ['passive', 'random', 'attentive'] as Bot[]) {
    it(`${bot} bot`, { timeout: 55_000 }, () => {
      results[bot] = SEEDS.map((seed) => play(seed, bot));
      // eslint-disable-next-line no-console
      console.log(table(bot, results[bot]));
    });
  }

  it('meets the targets', () => {
    const { passive, random, attentive } = results;
    // Passive play is punished: ousted on at least half the seeds, mostly in years 2-4.
    const pOusted = passive.filter((r) => r.ousted);
    expect(pOusted.length).toBeGreaterThanOrEqual(Math.ceil(passive.length / 2));
    expect(mean(pOusted, (r) => r.monthEnded)).toBeGreaterThan(12);
    // Random play: high variance, some ousters.
    expect(random.filter((r) => r.ousted).length).toBeGreaterThanOrEqual(1);
    // Attentive play usually survives, with tension.
    expect(attentive.filter((r) => !r.ousted).length).toBeGreaterThanOrEqual(Math.ceil(attentive.length * 0.6));
    expect(mean(attentive, (r) => r.confAvg)).toBeGreaterThan(40);
    expect(mean(attentive, (r) => r.confAvg)).toBeLessThan(85);
    expect(attentive.filter((r) => r.confMin < 45).length).toBeGreaterThanOrEqual(2);
    const survivors = attentive.filter((r) => !r.ousted);
    expect(mean(survivors, (r) => r.priceEnd / r.priceStart)).toBeGreaterThan(0.7);
    // One extra RNG draw a month moves this mean by ~0.25 on the same seeds, so the cap leaves room for that noise.
    expect(mean(survivors, (r) => r.priceEnd / r.priceStart)).toBeLessThan(2.1);
    expect(mean(survivors, (r) => r.cashEnd)).toBeLessThan(60_000_000);
    for (const r of [...passive, ...random, ...attentive]) {
      expect(r.inboxPerMonth).toBeGreaterThanOrEqual(1.5);
      expect(r.inboxPerMonth).toBeLessThanOrEqual(7);
    }
    for (const r of survivors) {
      expect(r.staffEnd).toBeGreaterThan(300);
      expect(r.staffEnd).toBeLessThan(560);
    }
    expect(mean(attentive, (r) => r.quits)).toBeGreaterThan(5);
    expect(mean(attentive, (r) => r.fires)).toBeGreaterThan(3);
  });
});
