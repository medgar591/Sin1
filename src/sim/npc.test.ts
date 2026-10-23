import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npcTuning, runNpcMonth } from './npc';
import { makePerson, smallCompany } from './testkit';
import { generateGame } from './generate';
import { addSecret, adjustOpinion, opinionOf, removeFromCompany, setTag } from './org';
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
    const before = opinionOf(f.state, b.id, f.head.id);
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
    const inc = f.state.incidents.find((i) => i.kind === 'seatVacancy');
    expect(inc).toBeDefined();
    expect(inc!.unitId).toBe(f.division.id);
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

describe('politics', () => {
  /** Runs months until an incident of the kind appears; returns it, or undefined after `max` months. */
  function until(state: GameState, kind: string, max: number) {
    for (let i = 0; i < max; i++) {
      runNpcMonth(state);
      const found = state.incidents.find((x) => x.kind === kind);
      state.incidents = [];
      state.month++;
      if (found) return found;
    }
    return undefined;
  }

  /** The CFO runs a campaign against the CEO; a loyal colleague works in Finance. */
  function plotAgainstCeo() {
    const f = smallCompany();
    const colleague = makePerson(f.state, 'worker', { unitId: f.finance.id, loyalty: 80 });
    f.finance.memberIds.push(colleague.id);
    f.state.plots[f.cfo.id] = { targetId: f.ceo.id, progress: 0, stage: 0 };
    return { f, colleague };
  }

  it('a long-running unknown plot against the CEO eventually draws a tip-off', () => {
    const { f, colleague } = plotAgainstCeo();
    const inc = until(f.state, 'tipOff', 150);
    expect(inc).toBeDefined();
    expect(inc!.personIds).toEqual([colleague.id, f.cfo.id, f.ceo.id]);
    expect(inc!.unitId).toBe(f.finance.id);
    expect(colleague.history.some((e) => e.kind === 'tipOff')).toBe(true);
  });

  it('nobody tips off a plot the CEO already knows about', () => {
    const { f } = plotAgainstCeo();
    f.state.plots[f.cfo.id].known = true;
    expect(until(f.state, 'tipOff', 60)).toBeUndefined();
  });

  it('the plotter\'s own clique does not inform on them', () => {
    const { f, colleague } = plotAgainstCeo();
    f.state.cliques.k1 = { id: 'k1', name: 'The Old Hands', leaderId: f.cfo.id, memberIds: [f.cfo.id, colleague.id], agenda: 'x', known: false, momentum: 0 };
    f.cfo.cliqueId = 'k1';
    colleague.cliqueId = 'k1';
    npcTuning.tipOffBaseCeo = 1;
    expect(until(f.state, 'tipOff', 20)).toBeUndefined();
  });

  it('an ambitious division head pitches against a rival, carrying a secret, then waits a year', () => {
    const f = smallCompany();
    npcTuning.pitchChance = 1;
    f.head.ambition = 90;
    f.head.involvement = 90;
    f.head.skills.guile = 80;
    setTag(f.state, f.head.id, f.lead.id, 'rival');
    const sec = addSecret(f.state, f.lead.id, { kind: 'embezzlement', description: 'Has been skimming.', severity: 2 });
    const inc = until(f.state, 'pitch', 6);
    expect(inc).toMatchObject({ kind: 'pitch', personIds: [f.head.id, f.lead.id], secretId: sec.id });
    expect(f.head.history.some((e) => e.kind === 'pitched')).toBe(true);
    expect(until(f.state, 'pitch', 11)).toBeUndefined();
  });

  it('low-ambition managers and workers do not pitch', () => {
    const f = smallCompany();
    npcTuning.pitchChance = 1;
    setTag(f.state, f.head.id, f.lead.id, 'rival');
    setTag(f.state, f.workers[0].id, f.lead.id, 'rival');
    f.workers[0].ambition = 100;
    f.workers[0].involvement = 100;
    expect(until(f.state, 'pitch', 12)).toBeUndefined();
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
    expect(f.state.incidents.find((i) => i.kind === 'poachOffer')).toBeTruthy();
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
