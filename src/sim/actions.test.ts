import { describe, expect, it, vi } from 'vitest';
import { makePerson, makeUnit, smallCompany } from './testkit';
import type { GameState } from './types';

vi.mock('./generate', async () => {
  const kit = await import('./testkit');
  return {
    marketSalary: () => 60_000,
    createPerson: (state: GameState, o: { role: never; salary?: number }) =>
      kit.makePerson(state, o.role, { salary: o.salary ?? 60_000, title: '' }),
  };
});

import * as A from './actions';
import { buildEpilogue, computeScore, endGame } from './epilogue';
import { chainOfCommand, setTag } from './org';

function checkTree(state: GameState) {
  const root = state.units[state.rootUnitId];
  expect(root.parentId).toBeNull();
  const seen = new Set<string>();
  const walk = (id: string, div: string | null) => {
    expect(seen.has(id)).toBe(false);
    seen.add(id);
    const u = state.units[id];
    expect(u).toBeDefined();
    const d = u.kind === 'division' ? u.id : u.kind === 'executive' || u.kind === 'function' ? null : div;
    if (u.kind !== 'function' && u.kind !== 'executive') expect(u.divisionId).toBe(d);
    for (const c of u.childIds) {
      expect(state.units[c].parentId).toBe(id);
      walk(c, d);
    }
  };
  walk(root.id, null);
  expect(seen.size).toBe(Object.keys(state.units).length);
  for (const u of Object.values(state.units)) {
    if (u.leadId) expect(state.people[u.leadId].unitId).toBe(u.id);
    for (const m of u.memberIds) expect(state.people[m].unitId).toBe(u.id);
  }
}

describe('skip-level', () => {
  it('penalises the bypassed chain, boss most', () => {
    const { state, workers, lead, head, ceo } = smallCompany();
    const info = A.skipLevelInfo(state, workers[0].id);
    expect(info.bypassed).toEqual([lead.id, head.id]);
    const r = A.fire(state, workers[0].id);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('will remember you went around');
    expect(lead.loyalty).toBe(42);
    expect(head.loyalty).toBe(46);
    expect(state.relations[lead.id][ceo.id].opinion).toBeLessThan(state.relations[head.id][ceo.id].opinion);
  });
  it('is waived under attention and for direct reports', () => {
    const { state, workers, lead, head, cfo } = smallCompany();
    workers[0].attentionUntil = 5;
    expect(A.skipLevelInfo(state, workers[0].id).waived).toBe(true);
    A.fire(state, workers[0].id);
    expect(lead.loyalty).toBe(50);
    expect(head.loyalty).toBe(50);
    expect(A.skipLevelInfo(state, cfo.id).bypassed).toEqual([]);
    A.setSalary(state, head.id, 70_000);
    expect(head.loyalty).toBeGreaterThanOrEqual(50);
  });
  it('halves for meetings', () => {
    const { state, workers, lead } = smallCompany();
    A.meet(state, workers[0].id, 'rapport');
    expect(lead.loyalty).toBe(46);
  });
});

describe('attention', () => {
  it('is enforced and spent', () => {
    const { state, workers } = smallCompany();
    state.player.attentionLeft = 1;
    expect(A.fire(state, workers[0].id).ok).toBe(true);
    expect(state.player.attentionLeft).toBe(0);
    const r = A.fire(state, workers[1].id);
    expect(r.ok).toBe(false);
    expect(workers[1].status).toBe('active');
    expect(A.setGuidance(state, 1_000_000).ok).toBe(true); // free
  });
  it('rejects nonsense and game over', () => {
    const { state, ceo, directors, workers } = smallCompany();
    expect(A.fire(state, ceo.id).ok).toBe(false);
    expect(A.fire(state, directors[0].id).ok).toBe(false);
    expect(state.player.attentionLeft).toBe(3);
    A.retire(state);
    expect(A.fire(state, workers[0].id).ok).toBe(false);
  });
});

describe('seats', () => {
  it('promote displaces the lead into the same unit', () => {
    const { state, team, lead, workers } = smallCompany();
    const w = workers[0];
    w.ambition = 80;
    workers[1].ambition = 90;
    const before = w.salary;
    const r = A.promote(state, w.id, team.id);
    expect(r.ok).toBe(true);
    expect(team.leadId).toBe(w.id);
    expect(w.role).toBe('teamLead');
    expect(w.title).toBe(`Team Lead, ${team.name}`);
    expect(w.salary).toBeGreaterThanOrEqual(before * 1.12 - 500);
    expect(team.memberIds).toContain(lead.id);
    expect(team.memberIds).not.toContain(w.id);
    expect(lead.role).toBe('worker');
    expect(lead.unitId).toBe(team.id);
    expect(workers[1].history.some((e) => e.kind === 'passedOver')).toBe(true);
    expect(w.history.at(-1)?.byPlayer).toBe(true);
    checkTree(state);
  });
  it('refuses non-promotions', () => {
    const { state, team, lead, head } = smallCompany();
    expect(A.promote(state, head.id, team.id).ok).toBe(false);
    expect(A.promote(state, lead.id, team.id).ok).toBe(false);
  });
  it('demote leaves a member and an empty seat', () => {
    const { state, team, lead } = smallCompany();
    expect(A.demote(state, lead.id).ok).toBe(true);
    expect(team.leadId).toBeNull();
    expect(team.memberIds).toContain(lead.id);
    expect(lead.role).toBe('worker');
    expect(lead.history.at(-1)?.impact).toBeLessThan(0);
    checkTree(state);
  });
  it('reassign moves members only', () => {
    const { state, workers, lead, division } = smallCompany();
    const t2 = makeUnit(state, 'team', division.id, { divisionId: division.id });
    expect(A.reassign(state, workers[0].id, t2.id).ok).toBe(true);
    expect(t2.memberIds).toEqual([workers[0].id]);
    expect(A.reassign(state, lead.id, t2.id).ok).toBe(false);
    checkTree(state);
  });
  it('hire fills only empty lead seats and charges premium fees', () => {
    const { state, team, division } = smallCompany();
    expect(A.hire(state, team.id, true, 'standard').ok).toBe(false);
    expect(state.player.attentionLeft).toBe(3);
    const cash = state.company.cash;
    expect(A.hire(state, team.id, false, 'premium').ok).toBe(true);
    expect(state.company.cash).toBeLessThan(cash);
    const t2 = makeUnit(state, 'team', division.id, { divisionId: division.id });
    expect(A.hire(state, t2.id, true, 'cheap').ok).toBe(true);
    expect(state.people[t2.leadId!].role).toBe('teamLead');
    checkTree(state);
  });
});

describe('fire', () => {
  it('records events, severance and protector anger', () => {
    const { state, workers, cfo, ceo } = smallCompany();
    const w = workers[0];
    setTag(state, cfo.id, w.id, 'protege');
    setTag(state, w.id, cfo.id, 'mentor');
    const cash = state.company.cash;
    const r = A.fire(state, w.id);
    expect(r.ok).toBe(true);
    expect(w.status).toBe('fired');
    expect(w.fate).toBeTruthy();
    expect(state.company.cash).toBeLessThan(cash);
    expect(w.history.at(-1)).toMatchObject({ kind: 'fired', byPlayer: true });
    expect(state.relations[cfo.id][ceo.id].opinion).toBeLessThanOrEqual(-14);
  });
});

describe('pay', () => {
  it('responds to greed', () => {
    const a = smallCompany();
    const b = smallCompany();
    a.workers[0].greed = 90;
    b.workers[0].greed = 10;
    A.setSalary(a.state, a.workers[0].id, 90_000);
    A.setSalary(b.state, b.workers[0].id, 90_000);
    expect(a.workers[0].satisfaction).toBeGreaterThan(b.workers[0].satisfaction);
    expect(A.setSalary(a.state, a.workers[1].id, -5).ok).toBe(false);
  });
  it('options are bounded', () => {
    const { state, workers } = smallCompany();
    expect(A.grantOptions(state, workers[0].id, 1_000).ok).toBe(true);
    expect(workers[0].stockOptions).toBe(1_000);
    expect(A.grantOptions(state, workers[0].id, 0).ok).toBe(false);
  });
  it('bonus allocation respects the pool', () => {
    const { state, workers, cfo } = smallCompany();
    expect(A.allocateBonus(state, {}).ok).toBe(false);
    state.company.bonusPool = 100_000;
    const cash = state.company.cash;
    expect(A.allocateBonus(state, { [workers[0].id]: 150_000 }).ok).toBe(false);
    expect(state.company.bonusPool).toBe(100_000);
    cfo.loyalty = 50;
    expect(A.allocateBonus(state, { [workers[0].id]: 20_000 }).ok).toBe(true);
    expect(state.company.bonusPool).toBe(0);
    expect(state.company.cash).toBe(cash + 80_000);
    expect(cfo.loyalty).toBeLessThan(50); // expected a share, got none
  });
  it('budget cannot go negative', () => {
    const { state, team } = smallCompany();
    expect(A.setBudget(state, team.id, -1).ok).toBe(false);
    expect(A.setBudget(state, team.id, 40_000).ok).toBe(true);
    expect(team.budget).toBe(40_000);
  });
  it('guidance once', () => {
    const { state } = smallCompany();
    expect(A.setGuidance(state, NaN).ok).toBe(false);
    expect(A.setGuidance(state, 3e6).ok).toBe(true);
    expect(A.setGuidance(state, 4e6).ok).toBe(false);
  });
});

describe('restructuring', () => {
  function bigger() {
    const c = smallCompany();
    const div2 = makeUnit(c.state, 'division', c.root.id, { name: 'Division B' });
    div2.divisionId = div2.id;
    const sub = makeUnit(c.state, 'subdivision', c.division.id, { divisionId: c.division.id });
    const t2 = makeUnit(c.state, 'team', sub.id, { divisionId: c.division.id });
    const st = makeUnit(c.state, 'subteam', t2.id, { divisionId: c.division.id });
    return { ...c, div2, sub, t2, st };
  }
  it('moves subtree and restamps divisions', () => {
    const { state, sub, div2, t2, st } = bigger();
    expect(A.moveUnit(state, sub.id, div2.id).ok).toBe(true);
    expect(st.divisionId).toBe(div2.id);
    expect(t2.divisionId).toBe(div2.id);
    checkTree(state);
  });
  it('rejects cycles and root moves', () => {
    const { state, sub, st, root, division } = bigger();
    expect(A.moveUnit(state, sub.id, st.id).ok).toBe(false);
    expect(A.moveUnit(state, root.id, division.id).ok).toBe(false);
    expect(A.moveUnit(state, sub.id, sub.id).ok).toBe(false);
    expect(state.player.attentionLeft).toBe(3);
    checkTree(state);
  });
  it('merge and dissolve keep the tree consistent', () => {
    const { state, team, t2, st, lead, workers, division } = bigger();
    expect(A.mergeUnits(state, t2.id, team.id).ok).toBe(true);
    expect(state.units[team.id]).toBeUndefined();
    expect(t2.memberIds).toContain(lead.id);
    expect(t2.memberIds).toEqual(expect.arrayContaining(workers.map((w) => w.id)));
    checkTree(state);
    expect(A.dissolveUnit(state, t2.id).ok).toBe(false); // subteam can't sit under a subdivision
    expect(A.dissolveUnit(state, st.id).ok).toBe(true);
    expect(state.units[st.id]).toBeUndefined();
    checkTree(state);
    expect(A.dissolveUnit(state, division.id).ok).toBe(false);
  });
  it('creates units', () => {
    const { state, division } = bigger();
    expect(A.createUnit(state, division.id, 'team', 'Falcon').ok).toBe(true);
    expect(A.createUnit(state, division.id, 'subteam', 'Bad').ok).toBe(false);
    checkTree(state);
  });
});

describe('meetings and promises', () => {
  it('rapport builds opinion; paranoid is harder', () => {
    const { state, ceo, workers } = smallCompany();
    workers[1].traits = ['paranoid'];
    A.meet(state, workers[0].id, 'rapport');
    A.meet(state, workers[1].id, 'rapport');
    expect(state.relations[workers[0].id][ceo.id].opinion).toBeGreaterThan(state.relations[workers[1].id][ceo.id].opinion);
  });
  it('threaten cows', () => {
    const { state, workers } = smallCompany();
    workers[0].involvement = 50;
    A.meet(state, workers[0].id, 'threaten');
    expect(workers[0].involvement).toBe(35);
  });
  it('probe can reveal a secret and clique', () => {
    const { state, workers } = smallCompany();
    const w = workers[0];
    state.player.attentionLeft = 99;
    state.cliques.c1 = { id: 'c1', name: 'The Circle', leaderId: w.id, memberIds: [w.id], agenda: 'x', known: false };
    w.cliqueId = 'c1';
    w.secrets = [{ id: 's', kind: 'affair', description: 'an affair', severity: 1, revealed: false, involvedIds: [] }];
    w.skills.guile = 0;
    for (let i = 0; i < 30 && !w.secrets[0].revealed; i++) A.meet(state, w.id, 'probe');
    expect(w.secrets[0].revealed).toBe(true);
    expect(state.cliques.c1.known).toBe(true);
  });
  it('promise kept path (promotion)', () => {
    const { state, workers, team } = smallCompany();
    const w = workers[0];
    expect(A.meet(state, w.id, 'promise', { kind: 'promotion', detail: 'a team of your own', months: 3 }).ok).toBe(true);
    expect(w.loyalty).toBeGreaterThanOrEqual(58);
    A.promote(state, w.id, team.id);
    A.checkPromises(state);
    expect(state.promises[0].state).toBe('kept');
    expect(w.history.some((e) => e.kind === 'promiseKept')).toBe(true);
  });
  it('promise raise kept needs 10%', () => {
    const { state, workers } = smallCompany();
    const w = workers[0];
    A.meet(state, w.id, 'promise', { kind: 'raise', detail: 'a raise', months: 2 });
    A.setSalary(state, w.id, w.salary * 1.05);
    A.checkPromises(state);
    expect(state.promises[0].state).toBe('open');
    A.setSalary(state, w.id, 60_000 * 1.12);
    A.checkPromises(state);
    expect(state.promises[0].state).toBe('kept');
  });
  it('promise broken path hits friends too', () => {
    const { state, ceo, workers } = smallCompany();
    const [w, friend] = workers;
    setTag(state, friend.id, w.id, 'friend');
    A.meet(state, w.id, 'promise', { kind: 'promotion', detail: 'soon', months: 1 });
    state.month = 5;
    const loyalty = w.loyalty;
    const fop = state.relations[friend.id]?.[ceo.id]?.opinion ?? 0;
    A.checkPromises(state);
    expect(state.promises[0].state).toBe('broken');
    expect(w.loyalty).toBeLessThan(loyalty - 15);
    expect(state.relations[friend.id][ceo.id].opinion).toBeLessThan(fop);
    expect(w.history.at(-1)?.kind).toBe('promiseBroken');
  });
  it('protection kept at due month if employed', () => {
    const { state, workers } = smallCompany();
    A.meet(state, workers[0].id, 'promise', { kind: 'protection', detail: 'your job is safe', months: 2 });
    state.month = 1;
    A.checkPromises(state);
    expect(state.promises[0].state).toBe('open');
    state.month = 2;
    A.checkPromises(state);
    expect(state.promises[0].state).toBe('kept');
  });
});

describe('investigation', () => {
  function withSecurity() {
    const c = smallCompany();
    const sec = makeUnit(c.state, 'function', c.root.id, { name: 'Security', functionKind: 'security' });
    const head = makePerson(c.state, 'officer', { unitId: sec.id, skills: { work: 100, management: 50, operations: 50, finance: 50, guile: 100 } });
    sec.leadId = head.id;
    return { ...c, sec, head };
  }
  it('fails without a head of security', () => {
    const { state, workers } = smallCompany();
    expect(A.investigatePerson(state, workers[0].id).ok).toBe(false);
    expect(state.player.attentionLeft).toBe(3);
  });
  it('reveals secrets and marks cliques', () => {
    const { state, workers, team } = withSecurity();
    state.player.attentionLeft = 9;
    const w = workers[0];
    w.skills.guile = 10;
    w.secrets = [{ id: 's', kind: 'embezzlement', description: 'skimming', severity: 3, revealed: false, involvedIds: [] }];
    for (let i = 0; i < 20 && !w.secrets[0].revealed; i++) A.investigatePerson(state, w.id);
    expect(w.secrets[0].revealed).toBe(true);
    expect(w.investigatedMonth).toBe(0);
    const w2 = workers[1];
    state.cliques.c = { id: 'c', name: 'C', leaderId: w2.id, memberIds: [w2.id], agenda: '', known: false };
    w2.cliqueId = 'c';
    setTag(state, workers[0].id, w2.id, 'rival');
    const r = A.investigateUnit(state, team.id);
    expect(r.ok).toBe(true);
    expect(state.cliques.c.known).toBe(true);
    expect(team.investigatedMonth).toBe(0);
    expect(r.message).toContain('1 feud');
  });
});

describe('lobbying', () => {
  it('persuade, favor, pressure', () => {
    const { state, directors, ceo } = smallCompany();
    state.player.attentionLeft = 9;
    const [d0, d1, d2] = directors;
    expect(A.lobbyDirector(state, ceo.id, 'persuade').ok).toBe(false);
    A.lobbyDirector(state, d0.id, 'persuade');
    expect(state.relations[d0.id][ceo.id].opinion).toBeGreaterThan(0);
    const cash = state.player.personalCash;
    d1.traits = ['principled'];
    A.lobbyDirector(state, d1.id, 'favor');
    expect(state.player.personalCash).toBeLessThan(cash);
    expect(state.relations[d1.id][ceo.id].opinion).toBeLessThan(0);
    A.lobbyDirector(state, d2.id, 'pressure');
    expect(state.relations[d2.id][ceo.id].opinion).toBeLessThan(0);
    d2.secrets = [{ id: 's', kind: 'affair', description: 'x', severity: 2, revealed: true, involvedIds: [] }];
    A.lobbyDirector(state, d2.id, 'pressure');
    expect(state.relations[d2.id][ceo.id].opinion).toBeGreaterThan(0);
  });
});

describe('epilogue', () => {
  it('ranks and tells stories', () => {
    const { state, workers, lead, team } = smallCompany();
    workers[0].pronouns = 'she';
    A.promote(state, workers[0].id, team.id);
    state.month = 4;
    A.setSalary(state, workers[0].id, 100_000);
    A.fire(state, workers[1].id);
    const e = buildEpilogue(state);
    expect(e.helped[0].personId).toBe(workers[0].id);
    expect(e.helped[0].story).toContain('promoted her');
    expect(e.helped[0].story).toContain('still with the company');
    expect(e.harmed.map((x) => x.personId)).toEqual(expect.arrayContaining([workers[1].id, lead.id]));
    expect(e.harmed[0].impact).toBeLessThanOrEqual(e.harmed[1].impact);
    expect(e.harmed.find((x) => x.personId === workers[1].id)!.story).toContain('severance');
    expect(buildEpilogue(state, 1).harmed).toHaveLength(1);
  });
  it('ousted scores lower, scandal lowest; endGame idempotent', () => {
    const mk = () => {
      const c = smallCompany();
      c.state.month = 40;
      c.state.company.history = [{ month: 0, cash: 0, revenue: 0, costs: 0, profit: 0, sharePrice: 80, boardConfidence: 60, headcount: 3 }];
      return c;
    };
    const a = mk(), b = mk(), c = mk();
    endGame(a.state, 'retired');
    endGame(b.state, 'ousted');
    c.ceo.secrets = [{ id: 's', kind: 'coverUp', description: 'x', severity: 3, revealed: true, involvedIds: [] }];
    endGame(c.state, 'ousted');
    expect(Number.isInteger(a.state.gameOver!.score)).toBe(true);
    expect(b.state.gameOver!.score).toBeLessThan(a.state.gameOver!.score);
    expect(c.state.gameOver!.score).toBeLessThan(b.state.gameOver!.score);
    const len = a.state.log.length;
    endGame(a.state, 'ousted');
    expect(a.state.gameOver!.reason).toBe('retired');
    expect(a.state.log.length).toBe(len);
    expect(a.state.log.at(-1)!.importance).toBe(3);
    expect(computeScore(a.state)).toBe(a.state.gameOver!.score);
  });
});

it('chain helper sanity', () => {
  const { state, workers } = smallCompany();
  expect(chainOfCommand(state, workers[0].id).length).toBe(3);
});
