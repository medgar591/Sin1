import { describe, expect, it } from 'vitest';
import { smallCompany } from './testkit';
import { closeQuarter, computeOutputs, explainUnitOutput, runEconomyMonth, suggestedGuidance, unitMonthlyCost } from './economy';
import { adjustOpinion, setTag } from './org';
import type { GameState } from './types';

function fixture() {
  const f = smallCompany(7);
  // Give the team a realistic budget (4 heads x 2K).
  f.team.budget = 8_000;
  f.division.budget = 2_000;
  f.finance.budget = 4_000;
  f.state.units[f.root.id].budget = 0;
  f.ceo.salary = 1_200_000;
  return f;
}

function seedHistory(state: GameState, profits: number[]) {
  profits.forEach((profit, i) =>
    state.company.history.push({ month: i, cash: 0, revenue: profit * 4, costs: profit * 3, profit, sharePrice: 40, boardConfidence: 60, headcount: 10 }),
  );
}

describe('computeOutputs', () => {
  it('a bad manager lowers unit output and it rolls up to the division', () => {
    const good = fixture();
    const bad = fixture();
    bad.lead.skills.management = 5;
    bad.lead.skills.work = 10;
    computeOutputs(good.state);
    computeOutputs(bad.state);
    expect(bad.team.output).toBeLessThan(good.team.output - 10);
    expect(bad.division.output).toBeLessThan(good.division.output);
  });

  it('infighting and a bad relationship with reports hurt', () => {
    const a = fixture();
    const b = fixture();
    const w = b.workers[0];
    adjustOpinion(b.state, b.lead.id, w.id, -80);
    adjustOpinion(b.state, w.id, b.lead.id, -80);
    setTag(b.state, b.lead.id, w.id, 'rival');
    computeOutputs(a.state);
    computeOutputs(b.state);
    expect(b.team.output).toBeLessThan(a.team.output);
    const labels = explainUnitOutput(b.state, b.team.id).map((f) => f.label).join('|');
    expect(labels).toMatch(/Infighting/);
  });

  it('starving the budget hurts; overfunding helps only a little', () => {
    const base = fixture();
    const starved = fixture();
    const rich = fixture();
    starved.team.budget = 0;
    rich.team.budget = 40_000;
    for (const f of [base, starved, rich]) computeOutputs(f.state);
    expect(starved.team.output).toBeLessThan(base.team.output - 20);
    expect(rich.team.output).toBeGreaterThan(base.team.output);
    expect(rich.team.output - base.team.output).toBeLessThan(11);
  });

  it('an empty lead seat hurts and morale drifts rather than jumps', () => {
    const f = fixture();
    computeOutputs(f.state);
    const before = f.team.output;
    f.team.leadId = null;
    f.team.morale = 60;
    for (const w of f.workers) w.satisfaction = 0;
    computeOutputs(f.state);
    expect(f.team.output).toBeLessThan(before - 15);
    expect(f.team.morale).toBeGreaterThan(40);
    expect(f.team.morale).toBeLessThan(60);
  });

  it('explanation sums to output', () => {
    const f = fixture();
    computeOutputs(f.state);
    const total = 100 + explainUnitOutput(f.state, f.team.id).reduce((a, x) => a + x.effect, 0);
    expect(total).toBeCloseTo(f.team.output, 0);
  });

  it('is deterministic for a seed', () => {
    const a = fixture();
    const b = fixture();
    computeOutputs(a.state);
    computeOutputs(b.state);
    expect(a.state).toEqual(b.state);
  });
});

describe('runEconomyMonth', () => {
  it('records the month, pays the CEO, and counts overhead once', () => {
    const f = fixture();
    computeOutputs(f.state);
    const cash0 = f.state.company.cash;
    const personal0 = f.state.player.personalCash;
    runEconomyMonth(f.state);
    const rec = f.state.company.history[0];
    expect(rec.profit).toBe(f.state.company.cash - cash0);
    expect(f.state.player.personalCash - personal0).toBeCloseTo(100_000);
    const divCost = unitMonthlyCost(f.state, f.division.id);
    const overhead = unitMonthlyCost(f.state, f.root.id) - divCost;
    expect(rec.costs).toBeCloseTo(divCost + overhead);
    expect(rec.profit).toBeGreaterThan(0);
  });

  it('weak output cuts revenue; negative cash hurts confidence', () => {
    const a = fixture();
    const b = fixture();
    b.division.output = 60;
    a.division.output = 100;
    runEconomyMonth(a.state);
    runEconomyMonth(b.state);
    expect(b.state.divisions[b.division.id].revenue).toBeLessThan(a.state.divisions[a.division.id].revenue);
    const c = fixture();
    c.state.company.cash = -50_000_000;
    runEconomyMonth(c.state);
    expect(c.state.company.boardConfidence).toBeLessThan(60);
  });
});

describe('closeQuarter', () => {
  it('beating guidance raises price and confidence and sets a bonus pool', () => {
    const f = fixture();
    seedHistory(f.state, [900_000, 1_000_000, 1_100_000, 900_000, 1_000_000, 1_100_000]);
    f.state.company.sharePrice = 45; // a little below what trailing earnings are worth
    f.state.company.boardConfidence = 60; // confidence relaxes toward 50, so start mid-range
    f.state.company.guidance = 2_900_000;
    const q = closeQuarter(f.state);
    expect(q.profit).toBe(3_000_000);
    expect(q.surprise).toBeGreaterThan(0);
    expect(q.sharePriceAfter).toBeGreaterThan(q.sharePriceBefore);
    expect(q.boardConfidenceAfter).toBeGreaterThan(q.boardConfidenceBefore);
    expect(f.state.company.bonusPool).toBeGreaterThan(0);
    expect(f.state.company.guidance).toBeNull();
  });

  it('a miss hurts more than a beat of equal size helps; no guidance is mildly negative', () => {
    const beat = fixture();
    const miss = fixture();
    const none = fixture();
    for (const f of [beat, miss, none]) {
      seedHistory(f.state, [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000]);
      f.state.company.boardConfidence = 50;
      f.state.month = 20; // past the new-CEO grace period // no pull toward neutral
    }
    beat.state.company.guidance = 2_850_000;
    miss.state.company.guidance = 3_150_000;
    const b = closeQuarter(beat.state);
    const m = closeQuarter(miss.state);
    const n = closeQuarter(none.state);
    expect(b.boardConfidenceAfter - b.boardConfidenceBefore).toBeLessThan(m.boardConfidenceBefore - m.boardConfidenceAfter);
    expect(n.boardConfidenceAfter).toBeLessThan(n.boardConfidenceBefore);
  });

  it('suggested guidance is cautious relative to run-rate', () => {
    const f = fixture();
    seedHistory(f.state, [1_000_000, 1_000_000, 1_000_000]);
    const g = suggestedGuidance(f.state);
    expect(g).toBeLessThan(3_000_000);
    expect(g).toBeGreaterThan(2_500_000);
  });
});
