import { describe, expect, it } from 'vitest';
import { smallCompany, makePerson, makeUnit } from './testkit';
import { expireInbox, generateEvents, resolveInboxItem } from './events';
import { addSecret } from './org';
import type { Incident, IncidentKind } from './types';

function setup() {
  const c = smallCompany(7);
  c.state.month = 3;
  return c;
}

function raise(c: ReturnType<typeof setup>, kind: IncidentKind, ids: string[], extra = {}) {
  c.state.incidents.push({ kind, personIds: ids, unitId: c.team.id, ...extra } as Incident);
  generateEvents(c.state);
  return c.state.inbox[c.state.inbox.length - 1];
}

describe('incident items', () => {
  const [w0, w1] = [0, 1];
  type Fixture = ReturnType<typeof setup>;
  /** Worker 1 warns the lead about worker 0's plot. */
  const tipOffPlot = (c: Fixture) => {
    c.state.plots[c.workers[w0].id] = { targetId: c.lead.id, progress: 50, stage: 1 };
    return {};
  };
  /** The lead pitches against worker 0, offering a secret. */
  const pitchWithDirt = (c: Fixture) => ({ secretId: addSecret(c.state, c.workers[w0].id, { kind: 'embezzlement', description: 'Has been skimming.', severity: 2 }).id });
  it.each<[IncidentKind, (c: Fixture) => string[], ((c: Fixture) => object)?]>([
    ['raiseDemand', (c) => [c.workers[w0].id]],
    ['promotionDemand', (c) => [c.workers[w0].id]],
    ['feud', (c) => [c.workers[w0].id, c.workers[w1].id]],
    ['scheme', (c) => [c.workers[w0].id, c.lead.id]],
    ['leak', (c) => [c.workers[w0].id]],
    ['embezzlement', (c) => [c.workers[w0].id]],
    ['scandal', (c) => [c.workers[w0].id]],
    ['breakthrough', (c) => [c.workers[w0].id]],
    ['resignationThreat', (c) => [c.workers[w0].id]],
    ['poachOffer', (c) => [c.workers[w0].id]],
    ['complaint', (c) => [c.workers[w0].id, c.lead.id]],
    ['tipOff', (c) => [c.workers[w1].id, c.workers[w0].id, c.lead.id], tipOffPlot],
    ['pitch', (c) => [c.lead.id, c.workers[w0].id], pitchWithDirt],
  ])('%s makes an item with 2+ options that resolves via every option', (kind, ids, prep) => {
    const probe = setup();
    const item = raise(probe, kind, ids(probe), prep?.(probe));
    expect(item.kind).toBe(kind);
    expect(item.options.length).toBeGreaterThanOrEqual(2);
    expect(probe.state.incidents).toEqual([]);
    for (const opt of item.options) {
      const c = setup();
      c.state.player.attentionLeft = 3;
      const it2 = raise(c, kind, ids(c), prep?.(c));
      const r = resolveInboxItem(c.state, it2.id, opt.id);
      expect(r.ok, `${kind}/${opt.id}: ${r.message}`).toBe(true);
      expect(it2.resolution).toBe(opt.id);
      expect(it2.outcome, `${kind}/${opt.id}`).toBe(r.message);
    }
  });

  it('managerFiring can be overruled', () => {
    const c = setup();
    const f = c.workers[0];
    const unitId = c.team.id;
    // simulate npc firing
    c.team.memberIds = c.team.memberIds.filter((i) => i !== f.id);
    f.unitId = null; f.status = 'fired';
    c.state.incidents.push({ kind: 'managerFiring', personIds: [c.lead.id, f.id], unitId });
    generateEvents(c.state);
    const item = c.state.inbox[0];
    expect(resolveInboxItem(c.state, item.id, 'overrule').ok).toBe(true);
    expect(f.status).toBe('active');
    expect(f.unitId).toBe(unitId);
    expect(f.history.some((h) => h.byPlayer && h.impact > 0)).toBe(true);
  });

  it('cliqueFormed items offer break up and co-opt', () => {
    const c = setup();
    c.state.cliques.k1 = { id: 'k1', name: 'The Old Hands', leaderId: c.lead.id, memberIds: [c.lead.id, c.workers[0].id], agenda: 'Protect seniority.', known: false, momentum: 0 };
    c.lead.cliqueId = 'k1'; c.workers[0].cliqueId = 'k1';
    const item = raise(c, 'cliqueFormed', [c.lead.id], { cliqueId: 'k1' });
    expect(resolveInboxItem(c.state, item.id, 'coopt').ok).toBe(true);
    expect(c.state.cliques.k1.known).toBe(true);
  });
});

describe('consequences', () => {
  it('granting a raise raises salary and records a life event', () => {
    const c = setup();
    const w = c.workers[0];
    const before = w.salary;
    const item = raise(c, 'raiseDemand', [w.id], { pct: 0.2 });
    resolveInboxItem(c.state, item.id, 'grant');
    expect(w.salary).toBeGreaterThan(before * 1.19);
    expect(w.history.at(-1)).toMatchObject({ kind: 'raise', byPlayer: true });
    expect(w.history.at(-1)!.impact).toBeGreaterThan(0);
  });

  it('promising a raise creates a raise PlayerPromise due in 3 months', () => {
    const c = setup();
    const item = raise(c, 'raiseDemand', [c.workers[0].id]);
    resolveInboxItem(c.state, item.id, 'promise');
    expect(c.state.promises[0]).toMatchObject({ kind: 'raise', dueMonth: 6, state: 'open' });
  });

  it('firing after a scandal records -8 and removes the person', () => {
    const c = setup();
    const w = c.workers[0];
    const item = raise(c, 'scandal', [w.id]);
    expect(w.attentionUntil).toBe(c.state.month + 3);
    expect(w.attentionReason).toBeTruthy();
    resolveInboxItem(c.state, item.id, 'fire');
    expect(w.status).toBe('fired');
    expect(w.history.at(-1)).toMatchObject({ kind: 'fired', impact: -8, byPlayer: true });
  });

  it('cover-up adds a coverUp secret to the player and fires ripple to friends', () => {
    const c = setup();
    const w = c.workers[0];
    const friend = c.workers[1];
    friend.cliqueId = null;
    c.state.relations[friend.id] = { [w.id]: { opinion: 60, tag: 'friend' } };
    const item = raise(c, 'embezzlement', [w.id]);
    expect(resolveInboxItem(c.state, item.id, 'coverUp').ok).toBe(true);
    expect(c.ceo.secrets.some((s) => s.kind === 'coverUp' && s.involvedIds.includes(w.id))).toBe(true);
    // firing someone else ripples
    const c2 = setup();
    c2.state.relations[c2.workers[1].id] = { [c2.workers[0].id]: { opinion: 60, tag: 'friend' } };
    const before = c2.workers[1].loyalty;
    const it2 = raise(c2, 'leak', [c2.workers[0].id]);
    resolveInboxItem(c2.state, it2.id, 'fire');
    expect(c2.workers[1].loyalty).toBeLessThan(before);
  });

  it('seat vacancy offers named candidates and seats the chosen one', () => {
    const c = setup();
    c.division.leadId = null;
    c.head.unitId = null;
    c.state.incidents.push({ kind: 'seatVacancy', personIds: [], unitId: c.division.id });
    generateEvents(c.state);
    const item = c.state.inbox[0];
    expect(item.kind).toBe('seatVacancy');
    expect(item.options[0].id).toBe('leave');
    const seatOpt = item.options.find((o) => o.id.startsWith('seat:'))!;
    expect(seatOpt.hint).toMatch(/Work \d+/);
    expect(resolveInboxItem(c.state, item.id, seatOpt.id).ok).toBe(true);
    expect(c.division.leadId).toBe(seatOpt.id.slice(5));
  });

  it('refused raise can escalate to a resignation threat incident', () => {
    let seen = false;
    for (let seed = 1; seed < 60 && !seen; seed++) {
      const c = smallCompany(seed);
      c.workers[0].greed = 100; c.workers[0].loyalty = 10;
      const item = raise(c, 'raiseDemand', [c.workers[0].id]);
      resolveInboxItem(c.state, item.id, 'refuse');
      seen = c.state.incidents.some((i) => i.kind === 'resignationThreat');
    }
    expect(seen).toBe(true);
  });
});

describe('politics pulled to the CEO', () => {
  function plotted() {
    const c = setup();
    const [plotter, informant] = c.workers;
    c.state.plots[plotter.id] = { targetId: c.state.player.personId, progress: 45, stage: 1 };
    return { c, plotter, informant };
  }

  it('a tipOff item marks the plot known and puts the plotter on the radar', () => {
    const { c, plotter, informant } = plotted();
    expect(c.state.plots[plotter.id].known).toBeUndefined();
    const item = raise(c, 'tipOff', [informant.id, plotter.id, c.ceo.id]);
    expect(item.kind).toBe('tipOff');
    expect(item.speakerId).toBe(informant.id);
    expect(item.body).toContain('against you');
    expect(c.state.plots[plotter.id].known).toBe(true);
    expect(plotter.attentionReason).toBeTruthy();
  });

  it('tipOff options: note is the default, reward pays, watch sets the plot back', () => {
    const { c, plotter, informant } = plotted();
    const item = raise(c, 'tipOff', [informant.id, plotter.id, c.ceo.id]);
    expect(item.options.map((o) => o.id)).toEqual(['note', 'reward', 'watch']);
    const cash = c.state.company.cash;
    const loyalty = informant.loyalty;
    expect(resolveInboxItem(c.state, item.id, 'reward').ok).toBe(true);
    expect(c.state.company.cash).toBeLessThan(cash);
    expect(informant.loyalty).toBe(loyalty + 8);
    const c2 = plotted();
    const it2 = raise(c2.c, 'tipOff', [c2.informant.id, c2.plotter.id, c2.c.ceo.id]);
    c2.c.state.player.attentionLeft = 3;
    expect(resolveInboxItem(c2.c.state, it2.id, 'watch').ok).toBe(true);
    expect(c2.c.state.plots[c2.plotter.id].progress).toBe(25);
    expect(c2.plotter.investigatedMonth).toBe(c2.c.state.month);
  });

  it('a tipOff for a departed plotter is moot', () => {
    const { c, plotter, informant } = plotted();
    const item = raise(c, 'tipOff', [informant.id, plotter.id, c.ceo.id]);
    plotter.status = 'fired';
    expect(resolveInboxItem(c.state, item.id, 'watch').message).toMatch(/moot/);
  });

  it('backing a pitcher creates an open protection promise', () => {
    const c = setup();
    const item = raise(c, 'pitch', [c.lead.id, c.workers[0].id], { secretId: null });
    expect(item.options.map((o) => o.id)).toEqual(['neutral', 'back', 'warn']);
    const loyalty = c.lead.loyalty;
    expect(resolveInboxItem(c.state, item.id, 'back').ok).toBe(true);
    expect(c.state.promises.filter((p) => p.personId === c.lead.id && p.kind === 'protection' && p.state === 'open')).toHaveLength(1);
    expect(c.lead.loyalty).toBe(loyalty + 10);
  });

  it('backing a pitcher with a plot against the rival advances the plot', () => {
    const c = setup();
    c.state.plots[c.lead.id] = { targetId: c.workers[0].id, progress: 30, stage: 0 };
    const item = raise(c, 'pitch', [c.lead.id, c.workers[0].id], { secretId: null });
    resolveInboxItem(c.state, item.id, 'back');
    expect(c.state.plots[c.lead.id].progress).toBe(50);
  });

  it('taking dirt reveals the secret and promises protection', () => {
    const c = setup();
    const rival = c.workers[0];
    const sec = addSecret(c.state, rival.id, { kind: 'affair', description: 'Is seeing a client.', severity: 1 });
    const item = raise(c, 'pitch', [c.lead.id, rival.id], { secretId: sec.id });
    expect(item.data.secretId).toBe(sec.id);
    const r = resolveInboxItem(c.state, item.id, 'dirt');
    expect(r.message).toContain('Is seeing a client.');
    expect(sec.revealed).toBe(true);
    expect(rival.attentionReason).toBe('Exposed');
    expect(c.state.promises.some((p) => p.personId === c.lead.id && p.kind === 'protection')).toBe(true);
  });

  it('dirt is not offered once the secret is out', () => {
    const c = setup();
    const sec = addSecret(c.state, c.workers[0].id, { kind: 'affair', description: 'Is seeing a client.', severity: 1 });
    sec.revealed = true;
    const item = raise(c, 'pitch', [c.lead.id, c.workers[0].id], { secretId: sec.id });
    expect(item.options.some((o) => o.id === 'dirt')).toBe(false);
  });

  it('warning the rival sets back the pitcher\'s plot', () => {
    const c = setup();
    const rival = c.workers[0];
    c.state.plots[c.lead.id] = { targetId: rival.id, progress: 50, stage: 1 };
    const item = raise(c, 'pitch', [c.lead.id, rival.id], { secretId: null });
    const loyalty = rival.loyalty;
    expect(resolveInboxItem(c.state, item.id, 'warn').ok).toBe(true);
    expect(c.state.plots[c.lead.id].progress).toBe(20);
    expect(rival.loyalty).toBe(loyalty + 8);
    expect(c.state.relations[rival.id][c.lead.id].opinion).toBeLessThan(0);
    expect(c.state.relations[rival.id][c.lead.id].tag).toBe('rival');
  });
});

describe('attention', () => {
  it('fails gracefully when attention is short, and deducts when enough', () => {
    const c = setup();
    const item = raise(c, 'scheme', [c.workers[0].id, c.lead.id]);
    c.state.player.attentionLeft = 0;
    const r = resolveInboxItem(c.state, item.id, 'investigate');
    expect(r.ok).toBe(false);
    expect(item.resolution).toBeNull();
    c.state.player.attentionLeft = 2;
    expect(resolveInboxItem(c.state, item.id, 'investigate').ok).toBe(true);
    expect(c.state.player.attentionLeft).toBe(1);
  });
});

describe('volume and expiry', () => {
  it('caps new items and dedupes', () => {
    const c = setup();
    for (let i = 0; i < 12; i++) {
      const w = makePerson(c.state, 'worker', { unitId: c.team.id });
      c.state.incidents.push({ kind: 'raiseDemand', personIds: [w.id], unitId: c.team.id, pct: 0.15 });
      c.state.incidents.push({ kind: 'raiseDemand', personIds: [w.id], unitId: c.team.id, pct: 0.15 });
    }
    generateEvents(c.state);
    expect(c.state.inbox.length).toBe(6);
    expect(c.state.log.some((l) => l.text.startsWith('Not escalated'))).toBe(true);
  });

  it('prioritises senior people and drama', () => {
    const c = setup();
    for (let i = 0; i < 8; i++) {
      const w = makePerson(c.state, 'worker', { unitId: c.team.id });
      c.state.incidents.push({ kind: 'raiseDemand', personIds: [w.id], unitId: c.team.id, pct: 0.15 });
    }
    c.state.incidents.push({ kind: 'scandal', personIds: [c.head.id], unitId: c.division.id });
    generateEvents(c.state);
    expect(c.state.inbox.some((i) => i.kind === 'scandal')).toBe(true);
  });

  it('expiry resolves with the first option and logs', () => {
    const c = setup();
    const item = raise(c, 'raiseDemand', [c.workers[0].id]);
    const salary = c.workers[0].salary;
    c.state.month = item.expiresMonth;
    expireInbox(c.state);
    expect(item.resolution).toBe(item.options[0].id);
    expect(c.workers[0].salary).toBe(salary);
    expect(c.state.log.some((l) => l.text.includes('No response'))).toBe(true);
    expect(item.outcome).toBeTruthy();
    expect(c.state.log.some((l) => l.text.includes(item.outcome!))).toBe(true);
  });

  it('keeps nothing for an item that is still waiting', () => {
    const c = setup();
    const item = raise(c, 'raiseDemand', [c.workers[0].id]);
    expect(item.outcome).toBeUndefined();
  });

  it('does not expire early', () => {
    const c = setup();
    const item = raise(c, 'raiseDemand', [c.workers[0].id]);
    expireInbox(c.state);
    expect(item.resolution).toBeNull();
  });
});

describe('world news', () => {
  function withIndustries(month: number) {
    const c = smallCompany(3);
    const inds = ['Logistics', 'Construction', 'Finance', 'Manastelliate', 'Pharma', 'Food'] as const;
    for (const ind of inds) {
      const u = makeUnit(c.state, 'division', c.root.id, { name: ind });
      u.divisionId = u.id;
      c.state.divisions[u.id] = { unitId: u.id, industry: ind, revenue: 1, costs: 1, growth: 0, market: 1, scale: 1 };
      makeUnit(c.state, 'team', u.id, { divisionId: u.id });
    }
    c.state.month = month;
    const byInd = (i: string) => Object.values(c.state.divisions).find((d) => d.industry === i)!;
    return { c, byInd };
  }

  it('Feb 2090 shifts Logistics, Construction up and Finance down', () => {
    const { c, byInd } = withIndustries(1);
    generateEvents(c.state);
    expect(byInd('Logistics').market).toBeGreaterThan(1.1);
    expect(byInd('Construction').market).toBeGreaterThan(1.05);
    expect(byInd('Finance').market).toBeLessThan(1);
    expect(c.state.log.some((l) => l.text.includes('Mammon') && l.importance === 2)).toBe(true);
  });

  it('Aug 2090 lifts Manastelliate and Pharma and offers talent', () => {
    const { c, byInd } = withIndustries(7);
    generateEvents(c.state);
    expect(byInd('Manastelliate').market).toBeGreaterThan(1.1);
    expect(byInd('Pharma').market).toBeGreaterThan(1.05);
    expect(c.state.log.some((l) => l.text.includes('Shan-Effort'))).toBe(true);
    expect(c.state.inbox.some((i) => i.kind === 'talentWave')).toBe(true);
  });

  it('markets stay in range and revert toward 1', () => {
    const { c } = withIndustries(10);
    for (const d of Object.values(c.state.divisions)) d.market = 1.4;
    for (let m = 10; m < 60; m++) { c.state.month = m; generateEvents(c.state); }
    for (const d of Object.values(c.state.divisions)) {
      expect(d.market).toBeGreaterThanOrEqual(0.7);
      expect(d.market).toBeLessThanOrEqual(1.4);
    }
  });
});

it('is deterministic', () => {
  const run = () => {
    const c = smallCompany(11);
    c.state.month = 12;
    for (let m = 12; m < 30; m++) {
      c.state.month = m;
      c.state.incidents.push({ kind: 'feud', personIds: [c.workers[0].id, c.workers[1].id], unitId: c.team.id });
      generateEvents(c.state);
    }
    return JSON.stringify([c.state.log, c.state.divisions, c.state.rngState]);
  };
  expect(run()).toBe(run());
});
