import { describe, expect, it } from 'vitest';
import { generateGame } from './generate';
import { advanceMonth } from './turn';
import { migrateState } from './migrate';
import type { GameState } from './types';

const opts = { companyName: 'Migrate Combine', playerFirstName: 'Ana', playerLastName: 'Reyes', playerPronouns: 'they' as const };

/** Rewrites a current state into the shape saves had before the sim's bookkeeping was typed. */
function toOldShape(state: GameState): Record<string, unknown> {
  const old = JSON.parse(JSON.stringify(state)) as Record<string, any>;
  old.npcPlots = old.plots;
  old.npcUnitSizes = old.unitSizes;
  old.npcSeatVacant = old.seatVacantSince;
  delete old.plots;
  delete old.unitSizes;
  delete old.seatVacantSince;
  for (const c of Object.values(old.cliques) as Record<string, unknown>[]) delete c.momentum;
  for (const d of Object.values(old.divisions) as Record<string, number>[]) {
    d.baseRevenue = d.scale / 1.5;
    d.growthIndex = 1.5;
    delete d.scale;
  }
  for (const pr of old.promises) delete pr.baseline;
  old.incidents = [
    { kind: 'raiseDemand', personIds: [state.player.personId], unitId: null, data: { pct: 0.2 } },
    { kind: 'promotionDemand', personIds: [], unitId: null, data: { vacantUnitId: state.rootUnitId } },
    { kind: 'scandal', personIds: [], unitId: null, data: { source: 'fixer', what: 'Traced.' } },
  ];
  return old;
}

describe('migrateState', () => {
  it('loads a save from before the typed bookkeeping and plays on', () => {
    const state = generateGame(3, opts);
    for (let i = 0; i < 6; i++) advanceMonth(state);
    state.promises.push({ id: 'pr1', personId: state.player.personId, kind: 'raise', madeMonth: 0, dueMonth: 9, detail: 'x', state: 'open', baseline: 0 });
    const migrated = migrateState(toOldShape(state) as unknown as GameState);

    expect(migrated.plots).toEqual(state.plots);
    expect(migrated.unitSizes).toEqual(state.unitSizes);
    expect(migrated.seatVacantSince).toEqual(state.seatVacantSince);
    expect('npcPlots' in migrated).toBe(false);
    for (const [id, d] of Object.entries(migrated.divisions)) expect(d.scale).toBeCloseTo(state.divisions[id].scale);
    for (const c of Object.values(migrated.cliques)) expect(typeof c.momentum).toBe('number');
    expect(migrated.promises.at(-1)!.baseline).toBe(state.people[state.player.personId].salary);
    expect(migrated.incidents).toEqual([
      { kind: 'raiseDemand', personIds: [state.player.personId], unitId: null, pct: 0.2 },
      { kind: 'seatVacancy', personIds: [], unitId: state.rootUnitId },
      { kind: 'fixerFallout', personIds: [], unitId: null, what: 'Traced.' },
    ]);

    for (let i = 0; i < 3; i++) advanceMonth(migrated);
    expect(migrated.month).toBe(9);
  });

  it('leaves a current state as it is', () => {
    const state = generateGame(4, opts);
    advanceMonth(state);
    const copy = JSON.parse(JSON.stringify(state)) as GameState;
    expect(migrateState(copy)).toEqual(state);
  });
});
