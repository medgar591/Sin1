import { describe, expect, it } from 'vitest';
import { smallCompany } from './testkit';
import { quoteFixerJob, resolveFixerJobs, startFixerJob, type FixerRequest } from './fixer';

function req(c: ReturnType<typeof smallCompany>, over: Partial<FixerRequest> = {}): FixerRequest {
  return { kind: 'materials', targetUnitId: c.division.id, targetPersonId: null, budget: 300_000, clean: false, ...over };
}

describe('quote', () => {
  it('success chance is monotonic in budget with diminishing returns', () => {
    const c = smallCompany();
    for (const kind of ['materials', 'specialHire', 'dirt'] as const) {
      const chances = [0.5, 1, 2, 3, 4, 6].map((k) => {
        const base = quoteFixerJob(c.state, req(c, { kind, budget: 1 })).minBudget;
        return quoteFixerJob(c.state, req(c, { kind, budget: base * k })).successChance;
      });
      for (let i = 1; i < chances.length; i++) expect(chances[i]).toBeGreaterThanOrEqual(chances[i - 1]);
      expect(chances[5] - chances[4]).toBeLessThan(chances[2] - chances[1]);
    }
  });
  it('clean costs more and cuts blowback', () => {
    const c = smallCompany();
    const a = quoteFixerJob(c.state, req(c));
    const b = quoteFixerJob(c.state, req(c, { clean: true }));
    expect(b.minBudget).toBeGreaterThan(a.minBudget);
    expect(b.blowbackRisk).toBeLessThan(a.blowbackRisk);
    expect(a.months).toBeGreaterThanOrEqual(1);
    expect(a.months).toBeLessThanOrEqual(2);
  });
});

describe('start', () => {
  it('validates, spends attention and cash', () => {
    const c = smallCompany();
    expect(startFixerJob(c.state, req(c, { budget: 10 })).ok).toBe(false);
    const cash = c.state.company.cash;
    expect(startFixerJob(c.state, req(c)).ok).toBe(true);
    expect(c.state.company.cash).toBe(cash - 300_000);
    expect(c.state.player.attentionLeft).toBe(2);
    expect(c.state.fixerJobs[0]).toMatchObject({ state: 'pending', report: null });
    c.state.player.attentionLeft = 0;
    expect(startFixerJob(c.state, req(c)).ok).toBe(false);
    expect(c.state.fixerJobs.length).toBe(1);
  });
  it('rejects bad targets and unaffordable budgets', () => {
    const c = smallCompany();
    expect(startFixerJob(c.state, req(c, { kind: 'dirt', targetUnitId: null, targetPersonId: null })).ok).toBe(false);
    expect(startFixerJob(c.state, req(c, { targetUnitId: null })).ok).toBe(false);
    c.state.company.cash = 1000;
    expect(startFixerJob(c.state, req(c)).ok).toBe(false);
  });
});

describe('resolve', () => {
  function runMany(kind: 'materials' | 'specialHire' | 'dirt', budgetMult: number, seeds = 40) {
    const out: string[] = [];
    for (let s = 1; s <= seeds; s++) {
      const c = smallCompany(s);
      c.workers[0].secrets.push({ id: 'x', kind: 'embezzlement', description: 'Skimmed the petty cash.', severity: 2, revealed: false, involvedIds: [] });
      const r: FixerRequest = { kind, targetUnitId: kind === 'dirt' ? null : kind === 'materials' ? c.division.id : c.team.id, targetPersonId: kind === 'dirt' ? c.workers[0].id : null, budget: 1, clean: false };
      r.budget = quoteFixerJob(c.state, r).minBudget * budgetMult;
      startFixerJob(c.state, r);
      c.state.month += 3;
      resolveFixerJobs(c.state);
      out.push(c.state.fixerJobs[0].state);
      if (c.state.fixerJobs[0].state === 'pending') throw new Error('unresolved');
      expect(c.state.fixerJobs[0].report).toBeTruthy();
      expect(c.state.log.some((l) => l.importance === 2 && l.text.startsWith('Fixer'))).toBe(true);
    }
    return out;
  }

  it('materials: bigger budget succeeds more, success lifts market', () => {
    const lo = runMany('materials', 1).filter((x) => x === 'success').length;
    const hi = runMany('materials', 5).filter((x) => x === 'success').length;
    expect(hi).toBeGreaterThan(lo);
    const c = smallCompany(2);
    for (let b = 1; b < 30; b++) {
      const cc = smallCompany(b);
      startFixerJob(cc.state, req(cc, { budget: 1_500_000 }));
      cc.state.month += 3;
      resolveFixerJobs(cc.state);
      if (cc.state.fixerJobs[0].state === 'success') {
        expect(cc.state.divisions[cc.division.id].market).toBeGreaterThan(1.1);
        return;
      }
    }
    expect(c).toBeTruthy();
    throw new Error('no success found');
  });

  it('specialHire success places a talented hire with attention and life event', () => {
    for (let s = 1; s < 40; s++) {
      const c = smallCompany(s);
      const r: FixerRequest = { kind: 'specialHire', targetUnitId: c.team.id, targetPersonId: null, budget: 3_000_000, clean: true };
      startFixerJob(c.state, r);
      c.state.month += 3;
      const before = Object.keys(c.state.people).length;
      resolveFixerJobs(c.state);
      if (c.state.fixerJobs[0].state !== 'success') continue;
      const p = Object.values(c.state.people).find((x) => x.history.some((h) => h.text.startsWith('Extracted from a rival corp')))!;
      expect(Object.keys(c.state.people).length).toBe(before + 1);
      expect(p.unitId).toBe(c.team.id);
      expect(c.team.memberIds).toContain(p.id);
      expect(p.skills.work).toBeGreaterThanOrEqual(80);
      expect(p.attentionUntil).toBeGreaterThan(c.state.month);
      expect(p.history.at(-1)!.byPlayer).toBe(true);
      return;
    }
    throw new Error('no success found');
  });

  it('dirt reveals a hidden secret; a clean target is a partial result, not a success', () => {
    let revealed = false;
    let clean = false;
    for (let s = 1; s < 40; s++) {
      const c = smallCompany(s);
      const dirty = c.workers[0];
      dirty.secrets.push({ id: 'x', kind: 'affair', description: 'An affair with a rival exec.', severity: 2, revealed: false, involvedIds: [] });
      startFixerJob(c.state, { kind: 'dirt', targetUnitId: null, targetPersonId: dirty.id, budget: 2_000_000, clean: false });
      startFixerJob(c.state, { kind: 'dirt', targetUnitId: null, targetPersonId: c.workers[1].id, budget: 2_000_000, clean: false });
      c.state.month += 3;
      resolveFixerJobs(c.state);
      if (c.state.fixerJobs[0].state === 'success') { revealed = dirty.secrets[0].revealed; expect(c.state.fixerJobs[0].report).toContain('affair'); }
      if (c.state.fixerJobs[1].state === 'partial') { clean = /nothing found/i.test(c.state.fixerJobs[1].report!); }
      if (revealed && clean) break;
    }
    expect(revealed).toBe(true);
    expect(clean).toBe(true);
  });

  it('failures can blow back with a board hit and an incident', () => {
    let seen = false;
    for (let s = 1; s < 80 && !seen; s++) {
      const c = smallCompany(s);
      startFixerJob(c.state, { kind: 'dirt', targetUnitId: null, targetPersonId: c.workers[0].id, budget: 100_000, clean: false });
      c.state.month += 3;
      const conf = c.state.company.boardConfidence;
      resolveFixerJobs(c.state);
      if (c.state.incidents.length) {
        seen = true;
        expect(c.state.incidents[0].kind).toBe('scandal');
        expect(c.state.company.boardConfidence).toBeLessThan(conf);
        expect(c.state.player.reputation).toBeLessThan(50);
      }
    }
    expect(seen).toBe(true);
  });

  it('does not resolve before resolveMonth and is deterministic', () => {
    const run = () => {
      const c = smallCompany(5);
      startFixerJob(c.state, req(c));
      resolveFixerJobs(c.state);
      expect(c.state.fixerJobs[0].state).toBe('pending');
      c.state.month += 2;
      resolveFixerJobs(c.state);
      return JSON.stringify(c.state.fixerJobs);
    };
    expect(run()).toBe(run());
  });
});
