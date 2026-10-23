import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npcTuning, runNpcMonth } from './npc';
import { smallCompany } from './testkit';
import { generateGame } from './generate';
import { adjustOpinion, removeFromCompany, setTag } from './org';
import type { GameState } from './types';

const saved = { ...npcTuning };
beforeEach(() => Object.assign(npcTuning, saved));
afterEach(() => Object.assign(npcTuning, saved));

/** A worker who has been warned and is a chronic poor performer. */
function poorWorker(f: ReturnType<typeof smallCompany>) {
  const w = f.workers[0];
  w.performance = 10;
  w.involvement = 0;
  w.history.push({ month: -6, kind: 'warned', text: 'Warned.', impact: -2, byPlayer: false });
  return w;
}

function run(state: GameState, months: number) {
  for (let i = 0; i < months; i++) {
    runNpcMonth(state);
    state.incidents = [];
    state.month++;
  }
}

describe('managers', () => {
  it('fires a warned chronic poor performer', () => {
    const f = smallCompany();
    npcTuning.fireChance = 1;
    const w = poorWorker(f);
    run(f.state, 3);
    expect(w.status).toBe('fired');
  });

  it('protects a worker with a skip-level relationship', () => {
    const f = smallCompany();
    npcTuning.fireChance = 1;
    npcTuning.pullChance = 0;
    const w = poorWorker(f);
    adjustOpinion(f.state, f.head.id, w.id, 70);
    run(f.state, 6);
    expect(w.status).toBe('active');
    expect(w.history.some((e) => e.kind === 'protected')).toBe(true);
  });

  it('protects via a mentor tag even with low opinion', () => {
    const f = smallCompany();
    npcTuning.fireChance = 1;
    npcTuning.pullChance = 0;
    const w = poorWorker(f);
    setTag(f.state, f.head.id, w.id, 'protege');
    run(f.state, 4);
    expect(w.status).toBe('active');
  });

  it('lets a protector pull the worker into their own unit', () => {
    const f = smallCompany();
    npcTuning.fireChance = 1;
    npcTuning.pullChance = 1;
    const w = poorWorker(f);
    adjustOpinion(f.state, f.head.id, w.id, 70);
    run(f.state, 4);
    expect(w.status).toBe('active');
    expect(w.unitId).toBe(f.division.id);
    expect(f.division.memberIds).toContain(w.id);
  });

  it('promotes from within and the passed-over ambitious resent it', () => {
    const f = smallCompany();
    npcTuning.fillChance = 1;
    removeFromCompany(f.state, f.lead.id, 'quit', 'Left.');
    const [a, b] = f.workers;
    a.performance = 85;
    a.ambition = 20;
    b.performance = 60;
    b.ambition = 90;
    b.involvement = 0;
    adjustOpinion(f.state, f.head.id, a.id, 60);
    adjustOpinion(f.state, f.head.id, b.id, -20);
    const before = adjustOpinion(f.state, b.id, f.head.id, 0).opinion;
    const sat = b.satisfaction;
    runNpcMonth(f.state);
    expect(f.team.leadId).toBe(a.id);
    expect(a.role).toBe('teamLead');
    expect(f.state.relations[b.id][f.head.id].opinion).toBeLessThan(before - 2);
    expect(b.satisfaction).toBeLessThan(sat);
    expect(b.history.some((e) => e.kind === 'passedOver')).toBe(true);
  });

  it('leaves an empty division head seat to the player and raises a promotionDemand', () => {
    const f = smallCompany();
    npcTuning.seatDemandChance = 1;
    removeFromCompany(f.state, f.head.id, 'quit', 'Left.');
    f.lead.performance = 80;
    runNpcMonth(f.state);
    expect(f.division.leadId).toBeNull();
    const inc = f.state.incidents.find((i) => i.kind === 'promotionDemand');
    expect(inc).toBeDefined();
    expect(inc!.data.vacantUnitId).toBe(f.division.id);
  });

  it('rehires to keep a unit near its size', () => {
    const f = smallCompany();
    npcTuning.hireChance = 1;
    run(f.state, 1);
    removeFromCompany(f.state, f.workers[1].id, 'quit', 'Left.');
    run(f.state, 1);
    expect(f.team.memberIds.length).toBe(3);
    const hired = f.state.people[f.team.memberIds[f.team.memberIds.length - 1]];
    expect(hired.history.some((e) => e.kind === 'hired' && !e.byPlayer)).toBe(true);
  });
});

describe('leaving', () => {
  it('quits at very low satisfaction', () => {
    const f = smallCompany();
    npcTuning.quitChance = 1;
    const w = f.workers[0];
    w.satisfaction = 0;
    w.performance = 30;
    w.skills.work = 40;
    runNpcMonth(f.state);
    expect(w.status).toBe('quit');
    expect(w.fate).toBeTruthy();
  });

  it('valuable people get a poach offer first, then defect', () => {
    const f = smallCompany();
    npcTuning.quitChance = 1;
    const w = f.workers[0];
    w.satisfaction = 0;
    w.performance = 90;
    runNpcMonth(f.state);
    expect(f.state.incidents.find((i) => i.kind === 'poachOffer')?.data.rivalCorp).toBeTruthy();
    expect(w.status).toBe('active');
    f.state.incidents = [];
    f.state.month++;
    w.satisfaction = 0;
    runNpcMonth(f.state);
    expect(w.status).toBe('defected');
  });
});

describe('whole company', () => {
  const make = (seed: number) =>
    generateGame(seed, { companyName: 'Testco', playerFirstName: 'A', playerLastName: 'B', playerPronouns: 'they' });

  it('keeps incident volume bounded over 24 months', () => {
    const state = make(7);
    const start = Object.values(state.people).filter((p) => p.status === 'active' && p.unitId).length;
    let total = 0;
    let worst = 0;
    const t0 = Date.now();
    for (let m = 0; m < 24; m++) {
      runNpcMonth(state);
      worst = Math.max(worst, state.incidents.length);
      total += state.incidents.length;
      state.incidents = [];
      state.month++;
    }
    const ms = (Date.now() - t0) / 24;
    const end = Object.values(state.people).filter((p) => p.status === 'active' && p.unitId).length;
    console.log({ avgIncidents: total / 24, worst, ms, start, end });
    expect(worst).toBeLessThanOrEqual(npcTuning.maxIncidentsPerMonth);
    expect(total / 24).toBeLessThanOrEqual(6);
    expect(end).toBeGreaterThan(start * 0.85);
    expect(ms).toBeLessThan(100);
  });

  it('is deterministic', () => {
    const a = make(3);
    const b = make(3);
    run(a, 12);
    run(b, 12);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
