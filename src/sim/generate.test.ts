import { describe, expect, it } from 'vitest';
import { createPerson, generateGame, unitName, type NewGameOptions } from './generate';
import { marketSalary, roleForUnitKind, salaryRange } from './roles';
import { activeStaff, bossOf, isQuarterEnd, monthLabel, quarterLabel } from './org';
import { boardExpectation, quarterOutlook } from './economy';
import { emptyState } from './testkit';

const OPTS: NewGameOptions = {
  companyName: 'Halcyon',
  playerFirstName: 'Ada',
  playerLastName: 'Voss',
  playerPronouns: 'she',
};
const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 31337];

describe('generateGame', () => {
  it('is deterministic', () => {
    expect(JSON.stringify(generateGame(5, OPTS))).toBe(JSON.stringify(generateGame(5, OPTS)));
    expect(JSON.stringify(generateGame(5, OPTS))).not.toBe(JSON.stringify(generateGame(6, OPTS)));
  });

  it('is fast enough', () => {
    generateGame(1, OPTS);
    const t = performance.now();
    generateGame(2, OPTS);
    expect(performance.now() - t).toBeLessThan(150);
  });

  it('has sensible headcount and divisions', () => {
    for (const seed of SEEDS) {
      const s = generateGame(seed, OPTS);
      const n = activeStaff(s).length;
      expect(n).toBeGreaterThan(340);
      expect(n).toBeLessThan(470);
      const divs = Object.values(s.divisions);
      expect(divs).toHaveLength(3);
      expect(new Set(divs.map((d) => d.industry)).size).toBe(3);
      const ops = Object.values(s.units).find((u) => u.functionKind === 'operations')!;
      for (const d of divs) {
        const u = s.units[d.unitId];
        expect(u.parentId).toBe(ops.id);
        const members = Object.values(s.people).filter((p) => p.unitId && s.units[p.unitId].divisionId === u.id);
        // Built at 100-150; a quarter of resignations can thin a division a little.
        expect(members.length).toBeGreaterThanOrEqual(90);
        expect(members.length).toBeLessThanOrEqual(150);
        expect(bossOf(s, u.leadId!)).toBe(ops.leadId);
      }
      expect(s.directors.length).toBeGreaterThanOrEqual(5);
      expect(s.directors.length).toBeLessThanOrEqual(7);
      // A quarter of dividends and wages has run since the opening 20M.
      expect(s.company.cash).toBeGreaterThan(10_000_000);
      expect(s.company.cash).toBeLessThan(30_000_000);
    }
  });

  it('keeps the tree consistent', () => {
    for (const seed of SEEDS) {
      const s = generateGame(seed, OPTS);
      const seen = new Map<string, string>();
      for (const u of Object.values(s.units)) {
        if (u.id === s.rootUnitId) expect(u.parentId).toBeNull();
        else expect(s.units[u.parentId!].childIds).toContain(u.id);
        for (const c of u.childIds) expect(s.units[c].parentId).toBe(u.id);
        if (u.leadId) {
          const lead = s.people[u.leadId];
          expect(lead.unitId).toBe(u.id);
          expect(lead.role).toBe(roleForUnitKind[u.kind]);
          expect(seen.has(lead.id)).toBe(false);
          seen.set(lead.id, u.id);
        }
        for (const m of u.memberIds) {
          expect(s.people[m].unitId).toBe(u.id);
          expect(seen.has(m)).toBe(false);
          seen.set(m, u.id);
        }
        if (u.kind === 'division') expect(u.divisionId).toBe(u.id);
        else if (u.parentId && ['subdivision', 'team', 'subteam'].includes(u.kind) && s.units[u.parentId].divisionId)
          expect(u.divisionId).toBe(s.units[u.parentId].divisionId);
      }
      for (const p of activeStaff(s)) expect(seen.get(p.id)).toBe(p.unitId);
      expect(seen.size).toBe(activeStaff(s).length);
      const names = Object.values(s.units).map((u) => u.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('builds an irregular tree', () => {
    let direct = 0;
    let withSubs = 0;
    for (const seed of SEEDS) {
      const s = generateGame(seed, OPTS);
      for (const u of Object.values(s.units)) {
        if (u.kind === 'team' && s.units[u.parentId!].kind === 'division') direct++;
        if (u.kind === 'team' && u.childIds.length >= 2) withSubs++;
      }
    }
    expect(direct).toBeGreaterThan(0);
    expect(withSubs).toBeGreaterThan(0);
  });

  it('has valid cliques, relations and secrets', () => {
    for (const seed of SEEDS) {
      const s = generateGame(seed, OPTS);
      const cliques = Object.values(s.cliques);
      // Three to five at the start; a quarter of company life can add one or thin a clique out.
      expect(cliques.length).toBeGreaterThanOrEqual(3);
      expect(cliques.length).toBeLessThanOrEqual(8);
      for (const c of cliques) {
        expect(c.memberIds.length).toBeGreaterThanOrEqual(2);
        expect(c.memberIds.length).toBeLessThanOrEqual(16);
        expect(c.known).toBe(false);
        for (const id of c.memberIds) expect(s.people[id].cliqueId).toBe(c.id);
      }
      for (const [a, row] of Object.entries(s.relations)) {
        expect(s.people[a]).toBeDefined();
        for (const [b, r] of Object.entries(row)) {
          expect(s.people[b]).toBeDefined();
          expect(a).not.toBe(b);
          expect(Math.abs(r.opinion)).toBeLessThanOrEqual(100);
        }
      }
      const staff = activeStaff(s);
      const withSecret = staff.filter((p) => p.secrets.length).length / staff.length;
      expect(withSecret).toBeGreaterThan(0.04);
      expect(withSecret).toBeLessThan(0.25);
      // a skip-level mentor exists
      const skip = staff.some((p) =>
        Object.entries(s.relations[p.id] ?? {}).some(
          ([id, r]) => r.tag === 'mentor' && ['subdivisionHead', 'divisionHead', 'officer'].includes(s.people[id].role) && p.role === 'worker',
        ),
      );
      expect(skip).toBe(true);
    }
  });

  it('seats the board and an antagonist', () => {
    const s = generateGame(3, OPTS);
    for (const d of s.directors) {
      const p = s.people[d.personId];
      expect(p.unitId).toBeNull();
      expect(['chair', 'director']).toContain(p.role);
    }
    const ceo = s.people[s.player.personId];
    expect(ceo.role).toBe('ceo');
    expect(ceo.loyalty).toBe(100);
    const foe = Object.values(s.people).find((p) => p.role === 'officer' && p.loyalty < 25 && p.ambition >= 90);
    expect(foe).toBeDefined();
    expect(s.relations[foe!.id][ceo.id].opinion).toBeLessThan(-30);
  });

  it('keeps salaries in role ranges', () => {
    const s = generateGame(11, OPTS);
    for (const p of Object.values(s.people)) {
      const [lo, hi] = salaryRange(p.role);
      expect(p.salary).toBeGreaterThanOrEqual(lo);
      expect(p.salary).toBeLessThanOrEqual(hi);
      expect(p.age).toBeGreaterThanOrEqual(22);
    }
    const workers = activeStaff(s).filter((p) => p.role === 'worker');
    const lowInv = workers.filter((p) => p.involvement < 25).length / workers.length;
    expect(lowInv).toBeGreaterThan(0.6);
  });
});

describe('the quarter before the game', () => {
  it('labels months before the game began', () => {
    expect(quarterLabel(-1)).toBe('Q4 2089');
    expect(quarterLabel(-3)).toBe('Q4 2089');
    expect(quarterLabel(-4)).toBe('Q3 2089');
    expect(quarterLabel(-12)).toBe('Q1 2089');
    expect(quarterLabel(0)).toBe('Q1 2090');
    expect(quarterLabel(11)).toBe('Q4 2090');
    expect(monthLabel(-1)).toBe('Dec 2089');
    expect(isQuarterEnd(-1)).toBe(true);
    expect(isQuarterEnd(-2)).toBe(false);
    expect(isQuarterEnd(-3)).toBe(false);
    expect(isQuarterEnd(-4)).toBe(true);
    expect(isQuarterEnd(2)).toBe(true);
    expect(isQuarterEnd(0)).toBe(false);
  });

  it('hands the player a company with a real Q4 2089 behind it', () => {
    for (const seed of SEEDS) {
      const s = generateGame(seed, OPTS);
      expect(s.month).toBe(0);

      // Three monthly records, Oct to Dec 2089, and a closed quarter.
      expect(s.company.history.map((r) => r.month)).toEqual([-3, -2, -1]);
      const meeting = s.boardMeetings[0];
      expect(s.boardMeetings).toHaveLength(1);
      expect(meeting.month).toBe(-1);
      expect(meeting.motions).toEqual([]);
      expect(meeting.summary).toContain('Q4 2089');
      expect(s.log.some((l) => l.month === -1 && l.text.startsWith('Q4 2089 closed'))).toBe(true);
      expect(s.log.every((l) => l.month <= 0)).toBe(true);

      // The predecessor retired; the player sits in the chair.
      const pre = s.prequel!;
      expect(pre).toBeDefined();
      const old = s.people[pre.predecessorId];
      expect(old.status).toBe('retired');
      expect(old.unitId).toBeNull();
      expect(old.fate).toMatch(/^Retired as CEO in Dec 2089 after \d+ years\.$/);
      expect(old.age).toBeGreaterThanOrEqual(58);
      expect(-old.hiredMonth).toBeGreaterThanOrEqual(6 * 12);
      expect(meeting.summary).toContain(`${old.firstName} ${old.lastName}`);
      const root = s.units[s.rootUnitId];
      expect(root.leadId).toBe(s.player.personId);
      expect(s.people[s.player.personId].unitId).toBe(root.id);
      expect(s.people[s.player.personId].role).toBe('ceo');
      expect(s.player.attentionLeft).toBe(s.player.attentionPerMonth);
      expect(root.memberIds).not.toContain(old.id);
      expect(s.unitChurn[root.id] ?? 0).toBe(0);
      expect(s.company.boardConfidence).toBeGreaterThanOrEqual(55);
      expect(s.company.boardConfidence).toBeLessThanOrEqual(65);
      for (const plot of Object.values(s.plots)) expect(plot.targetId).not.toBe(old.id);

      // Nothing from the predecessor's era reaches the player's desk or ledger.
      expect(s.inbox).toHaveLength(0);
      expect(s.incidents).toHaveLength(0);
      expect(s.promises).toHaveLength(0);
      expect(s.player.personalCash).toBe(2_000_000);
      for (const p of Object.values(s.people)) expect(p.history.some((e) => e.byPlayer)).toBe(false);

      // The record matches the books and feeds the board's bar.
      expect(pre.quarterMonth).toBe(-1);
      expect(pre.sharePrice).toBe(s.company.sharePrice);
      expect(pre.headcount).toBe(activeStaff(s).length);
      expect(pre.profit).toBe(s.company.history.reduce((a, r) => a + r.profit, 0));
      expect(pre.guidance).not.toBeNull();
      expect(s.company.guidance).toBeNull();
      expect(boardExpectation(s)).not.toBeNull();
      const outlook = quarterOutlook(s);
      expect(outlook.label).toBe('Q1 2090');
      expect(outlook.monthsIn).toBe(0);
      expect(outlook.expectation).toBe(boardExpectation(s));
      expect(s.asks).toHaveLength(2);
      for (const a of s.asks) expect(a.dueMonth).toBe(2);

      // The people around the chair got a first impression of the new CEO.
      const officer = Object.values(s.units).find((u) => u.functionKind === 'finance')!.leadId!;
      expect(s.relations[officer][s.player.personId]).toBeDefined();
      expect(s.relations[s.player.personId][officer]).toBeDefined();
    }
  });

  it('lets the company live in those months: the NPC world has moved', () => {
    let hires = 0;
    let departures = 0;
    for (const seed of SEEDS) {
      const s = generateGame(seed, OPTS);
      hires += s.log.filter((l) => l.month < 0 && / hired /.test(l.text)).length;
      departures += Object.values(s.people).filter((p) => p.leftMonth !== null && p.leftMonth < 0 && p.id !== s.prequel!.predecessorId).length;
      const q4 = s.log.filter((l) => l.month < 0);
      expect(q4.length).toBeGreaterThan(4);
    }
    expect(hires).toBeGreaterThan(0);
    expect(departures).toBeGreaterThan(0);
  });

  it('leaves the unallocated bonus pool for the new CEO', () => {
    const s = generateGame(2, OPTS);
    expect(s.company.bonusPool).toBeGreaterThan(0);
    expect(s.log.some((l) => l.month === 0 && l.text.includes('unallocated'))).toBe(true);
  });
});

describe('helpers', () => {
  it('marketSalary rises with quality', () => {
    expect(marketSalary('worker', 90)).toBeGreaterThan(marketSalary('worker', 10));
    expect(marketSalary('ceo', 50)).toBe(1_200_000);
  });

  it('createPerson and unitName work on a hand-made state', () => {
    const s = generateGame(8, OPTS);
    const p = createPerson(s, { role: 'worker', heritage: 'synth', pronouns: 'they' });
    expect(s.people[p.id]).toBe(p);
    expect(p.unitId).toBeNull();
    const team = Object.values(s.units).find((u) => u.kind === 'team' && u.divisionId)!;
    expect(unitName(s, 'subteam', team.id)).toMatch(/-\d+$/);
    const div = Object.values(s.units).find((u) => u.kind === 'division')!;
    expect(unitName(s, 'team', div.id)).toMatch(/\(.+\)$/);
    expect(emptyState().people).toEqual({});
  });
});
