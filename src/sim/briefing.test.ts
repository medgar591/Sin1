import { describe, expect, it } from 'vitest';
import { generateGame } from './generate';
import { openingBriefing } from './briefing';
import { activeDirectors, chiefOfStaff, formatZuzu, fullName, functionHead } from './org';
import { boardExpectation } from './economy';

const newGame = (seed: number) =>
  generateGame(seed, { companyName: 'Briefing Combine', playerFirstName: 'Ana', playerLastName: 'Reyes', playerPronouns: 'they' });

describe('openingBriefing', () => {
  it('is spoken by the chief of staff and names the chair, the rival, the divisions and the asks', () => {
    for (const seed of [1, 2, 3]) {
      const state = newGame(seed);
      const b = openingBriefing(state);
      const text = b.paragraphs.join('\n');
      expect(b.speakerId).toBe(chiefOfStaff(state)!.id);
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

  it('tells the new CEO about the predecessor and the quarter they left behind', () => {
    for (const seed of [1, 2, 3]) {
      const state = newGame(seed);
      const pre = state.prequel!;
      const old = state.people[pre.predecessorId];
      const text = openingBriefing(state).paragraphs.join('\n');
      expect(text).toContain(`${fullName(old)} ran the company for`);
      expect(text).toContain('retired at the end of December');
      expect(text).toContain('Q4 2089');
      expect(text).toContain(formatZuzu(pre.profit));
      expect(text).toContain(`guidance of ${formatZuzu(pre.guidance!)}`);
      expect(text).toMatch(/beating it|missing it/);
      expect(text).toContain(`The board now expects at least ${formatZuzu(boardExpectation(state)!)} a quarter`);
      if (state.company.bonusPool > 0) expect(text).toContain(`${formatZuzu(state.company.bonusPool)}, was left unallocated`);
    }
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

  it('copes without a chief of staff or a rival', () => {
    const state = newGame(5);
    state.units[state.rootUnitId].memberIds = [];
    state.rivalId = null;
    const b = openingBriefing(state);
    expect(b.speakerId).toBeNull();
    expect(b.paragraphs.join('\n')).not.toContain('Too quietly');
    expect(b.paragraphs.length).toBeGreaterThanOrEqual(5);
  });
});
