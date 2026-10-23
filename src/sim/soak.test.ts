// End-to-end: generate a company and let a simple bot play it for years,
// checking the tree and the numbers stay sane.
import { describe, expect, it } from 'vitest';
import { generateGame } from './generate';
import { advanceMonth } from './turn';
import { resolveInboxItem } from './events';
import { allocateBonus, setGuidance } from './actions';
import { suggestedGuidance } from './economy';
import { activeStaff, unit } from './org';
import { pick } from './rng';
import type { GameState } from './types';

function checkTree(state: GameState): void {
  for (const u of Object.values(state.units)) {
    if (u.parentId) expect(unit(state, u.parentId).childIds).toContain(u.id);
    for (const c of u.childIds) expect(unit(state, c).parentId).toBe(u.id);
    if (u.leadId) expect(state.people[u.leadId].unitId).toBe(u.id);
    for (const m of u.memberIds) expect(state.people[m].unitId).toBe(u.id);
    expect(Number.isFinite(u.output)).toBe(true);
    expect(Number.isFinite(u.morale)).toBe(true);
  }
  for (const p of activeStaff(state)) {
    const u = unit(state, p.unitId!);
    expect(u.leadId === p.id || u.memberIds.includes(p.id)).toBe(true);
    expect(Number.isFinite(p.performance)).toBe(true);
    expect(Number.isFinite(p.satisfaction)).toBe(true);
  }
  expect(Number.isFinite(state.company.cash)).toBe(true);
  expect(Number.isFinite(state.company.sharePrice)).toBe(true);
}

function playBot(seed: number, months: number) {
  const state = generateGame(seed, {
    companyName: 'Soak Combine',
    playerFirstName: 'Ana',
    playerLastName: 'Reyes',
    playerPronouns: 'they',
  });
  let items = 0;
  for (let i = 0; i < months && !state.gameOver; i++) {
    if (state.company.guidance === null) setGuidance(state, suggestedGuidance(state));
    if (state.company.bonusPool > 0) {
      const heads = activeStaff(state).filter((p) => p.role === 'officer' || p.role === 'divisionHead');
      const each = Math.floor(state.company.bonusPool / Math.max(1, heads.length));
      allocateBonus(state, Object.fromEntries(heads.map((p) => [p.id, each])));
    }
    for (const item of state.inbox.filter((it) => it.resolution === null)) {
      items++;
      resolveInboxItem(state, item.id, pick(state, item.options).id);
    }
    advanceMonth(state);
    checkTree(state);
  }
  return { state, items };
}

describe('soak', () => {
  it('plays five years on several seeds without breaking', { timeout: 60_000 }, () => {
    for (const seed of [1, 2, 3, 4]) {
      const { state, items } = playBot(seed, 60);
      const months = Math.max(1, state.month);
      const staff = activeStaff(state).length;
      // eslint-disable-next-line no-console
      console.log(
        `seed ${seed}: month ${state.month}, over=${state.gameOver?.reason ?? '-'}, staff ${staff}, ` +
          `cash ${(state.company.cash / 1e6).toFixed(1)}M, price ${state.company.sharePrice.toFixed(1)}, ` +
          `conf ${state.company.boardConfidence.toFixed(0)}, inbox/month ${(items / months).toFixed(1)}`,
      );
      expect(staff).toBeGreaterThan(250);
      expect(staff).toBeLessThan(700);
      expect(items / months).toBeLessThan(10);
    }
  });

  it('is deterministic for a seed', () => {
    const a = playBot(7, 18).state;
    const b = playBot(7, 18).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
