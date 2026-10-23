import { describe, expect, it } from 'vitest';
import { createPerson, generateGame, unitName, type NewGameOptions } from './generate';
import { marketSalary, roleForUnitKind, salaryRange } from './roles';
import { activeStaff, bossOf, isQuarterEnd, monthLabel, quarterLabel } from './org';
import { boardExpectation, EXPECT_QOQ, EXPECT_YOY, quarterOutlook } from './economy';
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
    // About 90 ms alone (twelve simulated months); the cap leaves room for a loaded CI box or a slow phone's share of it.
    expect(performance.now() - t).toBeLessThan(500);
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
        // Built at 100-150; a year of resignations and hires can thin or fatten a division a little.
        expect(members.length).toBeGreaterThanOrEqual(90);
        expect(members.length).toBeLessThanOrEqual(150);
        expect(bossOf(s, u.leadId!)).toBe(ops.leadId);
      }
      expect(s.directors.length).toBeGreaterThanOrEqual(5);
      expect(s.directors.length).toBeLessThanOrEqual(7);
      // A year of dividends and wages has run since the opening 20M.
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
      // Three to five at the start; a year of company life forms new ones faster than old ones thin out (4 to 12 over 40 seeds).
      expect(cliques.length).toBeGreaterThanOrEqual(3);
      expect(cliques.length).toBeLessThanOrEqual(14);
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

describe('the year before the game', () => {
  it('labels months before the game began', () => {
    expect(quarterLabel(-1)).toBe('Q4 2089');
    expect(quarterLabel(-3)).toBe('Q4 2089');
    expect(quarterLabel(-4)).toBe('Q3 2089');
    expect(quarterLabel(-12)).toBe('Q1 2089');
    expect(quarterLabel(0)).toBe('Q1 2090');
    expect(quarterLabel(11)).toBe('Q4 2090');
    expect(monthLabel(-1)).toBe('Dec 2089');
    expect(monthLabel(-12)).toBe('Jan 2089');
    expect(isQuarterEnd(-1)).toBe(true);
    expect(isQuarterEnd(-2)).toBe(false);
    expect(isQuarterEnd(-3)).toBe(false);
    expect(isQuarterEnd(-4)).toBe(true);
    expect(isQuarterEnd(2)).toBe(true);
    expect(isQuarterEnd(0)).toBe(false);
  });

  it('hands the player a company with a real 2089 behind it', () => {
    for (const seed of SEEDS) {
      const s = generateGame(seed, OPTS);
      expect(s.month).toBe(0);

      // Twelve monthly records, Jan to Dec 2089, and four closed quarters with a paper board meeting each.
      expect(s.company.history.map((r) => r.month)).toEqual([-12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1]);
      expect(s.boardMeetings.map((m) => m.month)).toEqual([-10, -7, -4, -1]);
      ['Q1 2089', 'Q2 2089', 'Q3 2089', 'Q4 2089'].forEach((q, i) => {
        const meeting = s.boardMeetings[i];
        expect(meeting.motions).toEqual([]);
        expect(meeting.summary).toContain(q);
        expect(meeting.summary).toContain('profit');
        // Only the last one marks the handover.
        expect(meeting.summary.includes('retirement')).toBe(i === 3);
        expect(s.log.some((l) => l.month === meeting.month && l.text === `Board meeting: ${meeting.summary}`)).toBe(true);
        expect(s.log.filter((l) => l.month === meeting.month && l.text.startsWith(`${q} closed`))).toHaveLength(1);
      });
      expect(s.log.filter((l) => /^Q\d 2089 closed/.test(l.text))).toHaveLength(4);
      expect(s.log.every((l) => l.month <= 0)).toBe(true);
      // Budgets and wages are marked up from the first January of the game, not inside the prequel.
      expect(s.log.some((l) => l.month < 0 && l.text.startsWith('Budgets marked up'))).toBe(false);
      // Calm times: no business cycle before the game.
      expect(s.macro).toBeNull();
      expect(s.log.some((l) => l.month < 0 && /downturn|boom/.test(l.text))).toBe(false);

      // The predecessor retired; the player sits in the chair.
      const pre = s.prequel!;
      expect(pre).toBeDefined();
      const old = s.people[pre.predecessorId];
      expect(old.status).toBe('retired');
      expect(old.unitId).toBeNull();
      expect(old.fate).toMatch(/^Retired as CEO in Dec 2089 after \d+ years\.$/);
      expect(old.age).toBeGreaterThanOrEqual(58);
      expect(-old.hiredMonth).toBeGreaterThanOrEqual(6 * 12);
      expect(s.boardMeetings[3].summary).toContain(`${old.firstName} ${old.lastName}`);
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
      const lastQuarter = s.company.history.slice(-3);
      expect(pre.quarterMonth).toBe(-1);
      expect(pre.sharePrice).toBe(s.company.sharePrice);
      expect(pre.headcount).toBe(activeStaff(s).length);
      expect(pre.profit).toBe(lastQuarter.reduce((a, r) => a + r.profit, 0));
      expect(pre.yearProfit).toBe(s.company.history.reduce((a, r) => a + r.profit, 0));
      expect(pre.yearStartSharePrice).toBe(40);
      expect(pre.guidance).not.toBeNull();
      expect(s.company.guidance).toBeNull();
      const bar = boardExpectation(s)!;
      expect(bar).not.toBeNull();
      // The bar is last quarter less a hair, or Q1 2089 plus the year-on-year step, whichever is higher.
      const q1 = s.company.history.slice(0, 3).reduce((a, r) => a + r.profit, 0);
      expect(bar).toBeCloseTo(Math.max(pre.profit * (1 + EXPECT_QOQ), q1 * (1 + EXPECT_YOY)), 0);
      const outlook = quarterOutlook(s);
      expect(outlook.label).toBe('Q1 2090');
      expect(outlook.monthsIn).toBe(0);
      expect(outlook.expectation).toBe(bar);
      expect(s.asks).toHaveLength(2);
      for (const a of s.asks) expect(a.dueMonth).toBe(2);

      // The people around the chair got a first impression of the new CEO.
      const officer = Object.values(s.units).find((u) => u.functionKind === 'finance')!.leadId!;
      expect(s.relations[officer][s.player.personId]).toBeDefined();
      expect(s.relations[s.player.personId][officer]).toBeDefined();
    }
  });

  it('has the predecessor guide every quarter, and sometimes miss', () => {
    let guided = 0;
    let beats = 0;
    let misses = 0;
    for (const seed of SEEDS) {
      const s = generateGame(seed, OPTS);
      for (const m of s.boardMeetings) {
        expect(m.summary).toMatch(/against guidance .+ \((beat|missed) by \d+%\)|on the nose/);
        guided++;
        if (/beat by/.test(m.summary)) beats++;
        if (/missed by/.test(m.summary)) misses++;
      }
    }
    expect(guided).toBe(SEEDS.length * 4);
    // Mostly a safe pair of hands, but not a perfect one.
    expect(beats).toBeGreaterThan(misses);
    expect(misses).toBeGreaterThan(0);
  });

  it('lets the company live through those months: the NPC world has moved', () => {
    let hires = 0;
    let departures = 0;
    for (const seed of SEEDS) {
      const s = generateGame(seed, OPTS);
      hires += s.log.filter((l) => l.month < 0 && / hired /.test(l.text)).length;
      departures += Object.values(s.people).filter((p) => p.leftMonth !== null && p.leftMonth < 0 && p.id !== s.prequel!.predecessorId).length;
      // A whole year of company life, not just December's.
      const early = s.log.filter((l) => l.month >= -12 && l.month <= -10);
      const late = s.log.filter((l) => l.month >= -3 && l.month < 0);
      expect(early.length).toBeGreaterThan(4);
      expect(late.length).toBeGreaterThan(4);
    }
    expect(hires).toBeGreaterThan(SEEDS.length * 3);
    expect(departures).toBeGreaterThan(SEEDS.length * 3);
  });

  it('pays the first three bonus pools out on the predecessor\'s word and leaves the last for the new CEO', () => {
    for (const seed of [2, 3, 7]) {
      const s = generateGame(seed, OPTS);
      const old = s.people[s.prequel!.predecessorId];
      const name = `${old.firstName} ${old.lastName}`;
      for (const month of [-10, -7, -4]) {
        expect(s.log.some((l) => l.month === month && l.text.includes(`${name} paid out the`) && l.text.includes('bonus pool'))).toBe(true);
      }
      expect(s.log.some((l) => l.month === -1 && l.text.includes(`${name} paid out`))).toBe(false);
      // Officers, division heads and strong performers were thanked, as the predecessor, never as the player.
      const bonuses = Object.values(s.people).flatMap((p) => p.history.filter((e) => e.kind === 'bonus'));
      expect(bonuses.length).toBeGreaterThan(20);
      for (const e of bonuses) {
        expect(e.byPlayer).toBe(false);
        expect(e.text).toMatch(new RegExp(`^Awarded a .+ bonus by ${name}\\.$`));
        expect([-10, -7, -4]).toContain(e.month);
      }
      // Only the Q4 2089 pool is waiting, and none of the earlier pools was left to double back into cash.
      expect(s.company.bonusPool).toBeGreaterThan(0);
      expect(s.company.bonusPool).toBeLessThan(s.prequel!.profit * 0.2);
      expect(s.log.some((l) => l.month === 0 && l.text.includes('Q4 2089 bonus pool') && l.text.includes('unallocated'))).toBe(true);
    }
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
