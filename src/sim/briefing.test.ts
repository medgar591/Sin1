import { describe, expect, it } from 'vitest';
import { generateGame } from './generate';
import { openingBriefing } from './briefing';
import { activeDirectors, formatZuzu, fullName, functionHead, placeAsMember, secretary } from './org';
import { boardExpectation } from './economy';

const newGame = (seed: number) =>
  generateGame(seed, { companyName: 'Briefing Combine', playerFirstName: 'Ana', playerLastName: 'Reyes', playerPronouns: 'they' });

describe('openingBriefing', () => {
  it('is spoken by the personal secretary and names the chair, the rival, the divisions and the asks', () => {
    for (const seed of [1, 2, 3]) {
      const state = newGame(seed);
      const b = openingBriefing(state);
      const text = b.paragraphs.join('\n');
      expect(b.speakerId).toBe(secretary(state)!.id);
      expect(state.people[b.speakerId!].title).toBe('Personal Secretary');
      expect(b.paragraphs.length).toBeGreaterThanOrEqual(7);
      expect(text).toContain('Ana');
      expect(text).toContain(fullName(state.people[b.speakerId!]));
      const chair = activeDirectors(state).find((d) => d.role === 'chair')!;
      expect(text).toContain(fullName(chair));
      expect(text).toContain(fullName(state.people[state.rivalId!]));
      expect(text).toContain('Too quietly.');
      expect(text).toContain('Below 30');
      expect(text).toContain(fullName(functionHead(state, 'operations')!));
      for (const id of Object.keys(state.divisions)) expect(text).toContain(state.units[id].name);
      expect(state.asks).toHaveLength(2);
      for (const a of state.asks) {
        expect(text).toContain(a.text);
        expect(text).toContain(fullName(state.people[a.directorId]));
      }
    }
  });

  it('speaks as the secretary who kept the predecessor\'s diary, in the first person', () => {
    for (const seed of [1, 2, 3]) {
      const state = newGame(seed);
      const sec = secretary(state)!;
      const old = state.people[state.prequel!.predecessorId];
      const [greeting, ...rest] = openingBriefing(state).paragraphs;
      const served = Math.floor(-sec.hiredMonth / 12);
      expect(greeting).toBe(
        `Good morning, Ana. I'm ${fullName(sec)}. I kept ${fullName(old)}'s diary for ${served} years, and now I keep yours. Before your first meeting, there are a few things you should know.`,
      );
      // A long-serving hand, so several years, and no more than the predecessor sat in the chair.
      expect(served).toBeGreaterThanOrEqual(5);
      expect(rest.join('\n')).toContain('What is said in this office stays in it');
      expect(rest.join('\n')).not.toMatch(/chief of staff/i);
    }
  });

  it('tells the new CEO about the predecessor, their year and the quarter they left behind', () => {
    for (const seed of [1, 2, 3]) {
      const state = newGame(seed);
      const pre = state.prequel!;
      const old = state.people[pre.predecessorId];
      const text = openingBriefing(state).paragraphs.join('\n');
      expect(text).toContain(`${fullName(old)} ran the company for`);
      expect(text).toContain('retired at the end of December');
      expect(text).toContain(`In 2089 it made ${formatZuzu(pre.yearProfit!)} across four quarters`);
      expect(text).toContain(`from ${formatZuzu(pre.yearStartSharePrice!)} to ${formatZuzu(pre.sharePrice)}`);
      expect(pre.yearProfit).toBeGreaterThan(pre.profit);
      expect(text).toContain('Q4 2089');
      // The longer view is one sentence: how much of the company predates the new chair.
      expect(text).toMatch(/Most of the company predates you: \d+ of its \d+ people have been here more than five years/);
      // Only the reported year is given as figures; the burn-in years have no numbers.
      expect(text).not.toMatch(/208[5-8]/);
      expect(text).toContain(formatZuzu(pre.profit));
      expect(text).toContain(`guidance of ${formatZuzu(pre.guidance!)}`);
      expect(text).toMatch(/beating it|missing it/);
      expect(text).toContain(`The board now expects at least ${formatZuzu(boardExpectation(state)!)} a quarter`);
      if (state.company.bonusPool > 0) expect(text).toContain(`${formatZuzu(state.company.bonusPool)}, was left unallocated`);
    }
  });

  it('falls back to the last quarter alone for a game saved before the full-year prequel', () => {
    const state = newGame(2);
    delete state.prequel!.yearProfit;
    delete state.prequel!.yearStartSharePrice;
    const text = openingBriefing(state).paragraphs.join('\n');
    expect(text).not.toContain('In 2089');
    expect(text).toContain(`Last quarter (Q4 2089) the company made ${formatZuzu(state.prequel!.profit)}`);
  });

  it('skips the predecessor in a game that began without one', () => {
    const state = newGame(6);
    delete state.prequel;
    expect(openingBriefing(state).paragraphs.join('\n')).not.toContain('retired at the end of December');
  });

  it('agrees pronouns with the rival', () => {
    const state = newGame(4);
    const rival = state.people[state.rivalId!];
    rival.pronouns = 'he';
    expect(openingBriefing(state).paragraphs.join('\n')).toContain('He took the news quietly.');
    rival.pronouns = 'they';
    expect(openingBriefing(state).paragraphs.join('\n')).toContain('They took the news quietly.');
  });

  it('copes without a secretary or a rival', () => {
    const state = newGame(5);
    state.units[state.rootUnitId].memberIds = [];
    state.rivalId = null;
    const b = openingBriefing(state);
    expect(b.speakerId).toBeNull();
    const text = b.paragraphs.join('\n');
    expect(text).not.toContain('Too quietly');
    // Nobody to say "I": the briefing is told in the third person.
    expect(text).not.toMatch(/\bI\b/);
    expect(b.paragraphs.length).toBeGreaterThanOrEqual(5);
  });

  it('finds a chief of staff in a game saved before the secretary, and falls back to anyone in the office', () => {
    const state = newGame(3);
    const root = state.units[state.rootUnitId];
    const sec = secretary(state)!;
    const other = Object.values(state.people).find((p) => p.role === 'worker' && p.status === 'active' && p.unitId !== root.id)!;
    placeAsMember(state, other.id, root.id);
    root.memberIds = [other.id, sec.id];
    expect(secretary(state)!.id).toBe(sec.id);
    sec.title = 'Chief of Staff';
    expect(secretary(state)!.id).toBe(sec.id);
    expect(openingBriefing(state).speakerId).toBe(sec.id);
    sec.title = 'Archivist';
    expect(secretary(state)!.id).toBe(other.id);
  });
});
