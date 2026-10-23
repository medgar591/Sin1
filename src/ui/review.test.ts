import { describe, expect, it } from 'vitest';
import { generateGame } from '../sim/generate';
import { advanceMonth } from '../sim/turn';
import { guidanceNote, monthReview, quarterCard, snapshotMonth } from './review';

const newGame = (seed: number) =>
  generateGame(seed, { companyName: 'Review Combine', playerFirstName: 'Ana', playerLastName: 'Reyes', playerPronouns: 'they' });

describe('month review', () => {
  it('shows only what the advance appended to the log, and the report card carries the rest of a quarter', () => {
    const g = newGame(12345);
    // A line from before the advance that the old month filter would have shown again.
    g.log.push({ month: g.month, text: 'Paid out 170Kㄓ in bonuses.', importance: 3, personIds: [] });
    for (let i = 0; i < 3; i++) {
      const b = snapshotMonth(g);
      const had = g.log.length;
      advanceMonth(g);
      const added = new Set(g.log.slice(had).map((l) => l.text));
      if (g.boardMeetings.length > b.meetings) {
        const card = quarterCard(b, g);
        expect(card.also.log.length).toBeLessThanOrEqual(3);
        for (const l of card.also.log) {
          expect(added.has(l.text)).toBe(true);
          expect(l.text).not.toMatch(/^(Q\d \d{4} closed:|Bonus pool |Dividend of |Board meeting:)/);
        }
        expect(card.cash).toEqual([b.cash, g.company.cash]);
        const paid = g.log.slice(had).find((l) => l.text.startsWith('Dividend of'));
        expect(card.dividend).toBe(paid ? /^Dividend of (\S+)/.exec(paid.text)![1] : null);
        expect(g.boardMeetings.at(-1)!.summary).toContain(`Board confidence ${Math.round(g.company.boardConfidence)}.`);
      } else {
        const r = monthReview(b, g);
        expect(r.log.length).toBeLessThanOrEqual(4);
        for (const l of r.log) {
          expect(added.has(l.text)).toBe(true);
          expect(l.text).not.toBe('Paid out 170Kㄓ in bonuses.');
        }
      }
    }
  });
});

describe('guidanceNote', () => {
  const card = (over: object) => ({ profit: 4_000_000, guidance: 3_900_000, bar: 4_000_000, share: [40, 41] as [number, number], ...over });

  it('says how much of the usual credit a beat earned from where guidance sat against the bar', () => {
    expect(guidanceNote(card({ guidance: 4_200_000, profit: 4_300_000 }))).toBe('Guided at 105% of the board’s bar: beating guidance earned the full price and confidence gain.');
    expect(guidanceNote(card({ guidance: 3_840_000, profit: 4_100_000 }))).toBe('Guided at 96% of the board’s bar: beating guidance earned 25% of the usual price and confidence gain.');
    expect(guidanceNote(card({ guidance: 3_600_000, profit: 4_100_000 }))).toContain('sandbagging');
    expect(guidanceNote(card({ bar: null }))).toContain('no bar');
  });

  it('only mentions the price drift when the price rose on a miss or with no guidance', () => {
    expect(guidanceNote(card({ profit: 3_000_000 }))).toMatch(/^Profit fell short of guidance.*The price still rose/);
    expect(guidanceNote(card({ profit: 3_000_000, share: [40, 39] }))).not.toContain('price still rose');
    expect(guidanceNote(card({ guidance: null }))).toMatch(/^With no guidance, the quarter counted against you\. The price still rose/);
    expect(guidanceNote(card({}))).not.toContain('price still rose');
  });
});
