// Fixer requests: a stripped-down Sinless run. The player asks for scarce
// materials, a special hire extracted from elsewhere, or dirt on someone,
// sets a budget and whether it must be clean, and gets a report later.
import type { ActionResult, FixerJob, FixerKind, GameState, PersonId, Secret, UnitId } from './types';
import { addLifeEvent, addLog, adjustLoyalty, clamp, formatZuzu, fullName, newId, person, placeAsMember, unit } from './org';
import { chance, randInt, random, rollPool } from './rng';
import { createPerson } from './generate';

export interface FixerRequest {
  kind: FixerKind;
  targetUnitId: UnitId | null;
  targetPersonId: PersonId | null;
  budget: number;
  clean: boolean;
}

export interface FixerQuote {
  /** Minimum sensible budget. */
  minBudget: number;
  /** 0..1 at the requested budget. */
  successChance: number;
  /** Months until the report comes back. */
  months: number;
  /** 0..1 chance it traces back to the company if it goes wrong. */
  blowbackRisk: number;
}

// ---------------------------------------------------------------- tuning

const BASE_MIN_BUDGET: Record<FixerKind, number> = { materials: 150_000, specialHire: 400_000, dirt: 100_000 };
const CLEAN_COST_MULT = 1.6;
const MONTHS: Record<FixerKind, number> = { materials: 2, specialHire: 2, dirt: 1 };
/** Hits (5s and 6s on d6) needed for a full success. */
const HITS_NEEDED: Record<FixerKind, number> = { materials: 2, specialHire: 3, dirt: 2 };
const BASE_BLOWBACK: Record<FixerKind, number> = { materials: 0.2, specialHire: 0.4, dirt: 0.35 };
const CLEAN_BLOWBACK_MULT = 0.35;
/** Dice pool = MIN_DICE + (MAX_DICE - MIN_DICE) * (1 - exp(-DICE_RATE * budget/minBudget)). */
const MIN_DICE = 3;
const MAX_DICE = 12;
const DICE_RATE = 0.8;
const HIT_P = 1 / 3;

const MATERIALS_MARKET_BOOST = 0.15; // fades via market mean reversion in events.ts
const BLOWBACK_BOARD_HIT = 3;
const BLOWBACK_REP_HIT = 4;

// ---------------------------------------------------------------- maths

function fractionalDice(ratio: number): number {
  return MIN_DICE + (MAX_DICE - MIN_DICE) * (1 - Math.exp(-DICE_RATE * Math.max(0, ratio)));
}

function binomAtLeast(n: number, k: number): number {
  let total = 0;
  let coeff = 1; // C(n, i)
  for (let i = 0; i <= n; i++) {
    if (i >= k) total += coeff * Math.pow(HIT_P, i) * Math.pow(1 - HIT_P, n - i);
    coeff = (coeff * (n - i)) / (i + 1);
  }
  return total;
}

function hitsNeeded(state: GameState, req: FixerRequest): number {
  let need = HITS_NEEDED[req.kind];
  // A guarded target is harder to dig into.
  if (req.kind === 'dirt' && req.targetPersonId && state.people[req.targetPersonId]) {
    const t = state.people[req.targetPersonId];
    if (t.traits.includes('paranoid') || t.skills.guile >= 75) need += 1;
  }
  return need;
}

export function quoteFixerJob(state: GameState, request: FixerRequest): FixerQuote {
  const minBudget = Math.round(BASE_MIN_BUDGET[request.kind] * (request.clean ? CLEAN_COST_MULT : 1));
  const ratio = request.budget / minBudget;
  const need = hitsNeeded(state, request);
  const nf = fractionalDice(ratio);
  const lo = Math.floor(nf);
  const frac = nf - lo;
  const successChance = binomAtLeast(lo, need) * (1 - frac) + binomAtLeast(lo + 1, need) * frac;
  const risk = BASE_BLOWBACK[request.kind] * (request.clean ? CLEAN_BLOWBACK_MULT : 1) / (1 + 0.3 * Math.max(0, ratio - 1));
  return {
    minBudget,
    successChance: clamp(successChance, 0, 1),
    months: MONTHS[request.kind],
    blowbackRisk: clamp(risk, 0, 1),
  };
}

function divisionOf(state: GameState, unitId: UnitId | null): UnitId | null {
  if (!unitId || !state.units[unitId]) return null;
  if (state.divisions[unitId]) return unitId;
  const d = state.units[unitId].divisionId;
  return d && state.divisions[d] ? d : null;
}

/** Pays the budget from company cash, spends attention, and queues the job. */
export function startFixerJob(state: GameState, request: FixerRequest): ActionResult {
  const q = quoteFixerJob(state, request);
  if (request.budget < q.minBudget) return { ok: false, message: `The fixer wants at least ${formatZuzu(q.minBudget)} for this.` };
  if (request.budget > state.company.cash) return { ok: false, message: 'The company cannot cover that budget.' };
  if (request.kind === 'materials' && !divisionOf(state, request.targetUnitId)) return { ok: false, message: 'Materials need a division to deliver to.' };
  if (request.kind === 'specialHire' && !(request.targetUnitId && state.units[request.targetUnitId])) return { ok: false, message: 'A specialist needs a unit to join.' };
  if (request.kind === 'dirt') {
    const t = request.targetPersonId ? state.people[request.targetPersonId] : undefined;
    if (!t || t.status !== 'active') return { ok: false, message: 'Dirt needs a target still with the company.' };
    if (t.id === state.player.personId) return { ok: false, message: 'You do not need a fixer to dig on yourself.' };
  }
  if (state.player.attentionLeft < 1) return { ok: false, message: 'No attention left this month.' };

  state.player.attentionLeft -= 1;
  state.company.cash -= request.budget;
  const job: FixerJob = {
    id: newId(state, 'fx'),
    kind: request.kind,
    targetUnitId: request.targetUnitId,
    targetPersonId: request.targetPersonId,
    budget: request.budget,
    clean: request.clean,
    startedMonth: state.month,
    resolveMonth: state.month + q.months,
    state: 'pending',
    report: null,
  };
  state.fixerJobs.push(job);
  return { ok: true, message: `The fixer takes the job. ${formatZuzu(request.budget)} paid, report in ${q.months} month${q.months > 1 ? 's' : ''}.` };
}

type Outcome = 'success' | 'partial' | 'failed';

function roll(state: GameState, job: FixerJob): Outcome {
  const q = quoteFixerJob(state, job);
  const nf = fractionalDice(job.budget / q.minBudget);
  const dice = Math.floor(nf) + (random(state) < nf - Math.floor(nf) ? 1 : 0);
  const hits = rollPool(state, dice);
  const need = hitsNeeded(state, job);
  if (hits >= need) return 'success';
  if (need >= 2 && hits === need - 1) return 'partial';
  return 'failed';
}

/** Resolves jobs due this month: applies results, writes the report, logs, may raise incidents. */
export function resolveFixerJobs(state: GameState): void {
  for (const job of state.fixerJobs) {
    if (job.state !== 'pending' || job.resolveMonth > state.month) continue;
    let outcome = roll(state, job);
    if (outcome === 'success' && job.kind === 'dirt') {
      // Digging up nothing on a clean target is not a win.
      const t = job.targetPersonId ? state.people[job.targetPersonId] : undefined;
      if (!t || !t.secrets.some((x) => !x.revealed)) outcome = 'partial';
    }
    job.state = outcome;
    const q = quoteFixerJob(state, job);
    const handler = { materials, specialHire, dirt }[job.kind];
    job.report = handler(state, job, outcome);
    if (outcome !== 'success') {
      const risk = outcome === 'failed' ? q.blowbackRisk : q.blowbackRisk / 2;
      if (chance(state, risk)) job.report += ' ' + blowback(state, job);
    }
    addLog(state, `Fixer (${job.kind}): ${outcome}. ${job.report}`, 2, job.targetPersonId ? [job.targetPersonId] : []);
  }
}

function blowback(state: GameState, job: FixerJob): string {
  state.company.boardConfidence = clamp(state.company.boardConfidence - BLOWBACK_BOARD_HIT);
  state.player.reputation = clamp(state.player.reputation - BLOWBACK_REP_HIT);
  const kind = job.kind === 'dirt' ? 'scandal' : 'leak';
  let what = 'A fixer job went wrong and the trail leads back to the company.';
  if (job.kind === 'dirt' && job.targetPersonId) {
    const t = person(state, job.targetPersonId);
    adjustLoyalty(state, t.id, -10);
    what = `${fullName(t)} found out someone was digging into ${pronounPoss(t)} life. The trail leads to the executive floor.`;
  } else if (job.kind === 'specialHire') {
    what = 'The rival corp has traced the extraction attempt to us and is telling the press.';
  } else {
    what = 'A shipment was seized and the paperwork names the company.';
  }
  state.incidents.push({ kind, personIds: [state.player.personId], unitId: job.targetUnitId, data: { source: 'fixer', what } });
  return 'It got out. Not my doing, but it is on you.';
}

const pronounPoss = (p: { pronouns: string }): string => (p.pronouns === 'she' ? 'her' : p.pronouns === 'he' ? 'his' : 'their');

function materials(state: GameState, job: FixerJob, outcome: Outcome): string {
  const divId = divisionOf(state, job.targetUnitId);
  const name = job.targetUnitId ? unit(state, job.targetUnitId).name : 'the division';
  if (!divId || outcome === 'failed') return `Supplier folded. Nothing for ${name}. Money is gone.`;
  const d = state.divisions[divId];
  d.market = clamp(d.market + (outcome === 'success' ? MATERIALS_MARKET_BOOST : MATERIALS_MARKET_BOOST / 2), 0.7, 1.4);
  return outcome === 'success'
    ? `Delivered. Crates at ${name}'s dock, paperwork clean. Production will run hot a few months.`
    : `Half the order landed at ${name}. The rest got diverted. Usable.`;
}

function specialHire(state: GameState, job: FixerJob, outcome: Outcome): string {
  const target = job.targetUnitId ? state.units[job.targetUnitId] : undefined;
  if (!target || outcome === 'failed') return 'Target stayed put. Rival counter-offered. Nothing to show for it.';
  const strong = outcome === 'success';
  const work = strong ? randInt(state, 82, 94) : randInt(state, 66, 76);
  const p = createPerson(state, { role: 'worker', quality: strong ? 80 : 66, skills: { work } });
  placeAsMember(state, p.id, target.id);
  p.hiredMonth = state.month;
  p.attentionUntil = state.month + 3;
  p.attentionReason = 'Extracted specialist';
  addLifeEvent(state, p.id, 'hired', 'Extracted from a rival corp and brought into the company.', 5, true);
  if (!strong) {
    const hook: Secret = {
      id: newId(state, 's'),
      kind: 'rivalPayroll',
      description: 'The old employer still has a hook in them.',
      severity: 2,
      revealed: false,
      involvedIds: [],
    };
    p.secrets.push(hook);
    return `${fullName(p)} is in ${target.name}. Good, not the best. Old employer may still have a line to them.`;
  }
  return `${fullName(p)} is in ${target.name}. Walked out clean with a good work history. Top of the field.`;
}

function dirt(state: GameState, job: FixerJob, outcome: Outcome): string {
  const t = job.targetPersonId ? state.people[job.targetPersonId] : undefined;
  if (!t) return 'Target gone. Nothing to find.';
  if (outcome === 'failed') return `Couldn't get near ${fullName(t)}. Nothing usable.`;
  t.investigatedMonth = state.month;
  const hidden = t.secrets.filter((s) => !s.revealed).sort((a, b) => b.severity - a.severity);
  if (!hidden.length) return `${fullName(t)} is clean. Nothing found. Some people really are.`;
  if (outcome === 'partial') {
    const minor = hidden[hidden.length - 1];
    if (minor.severity === 1) {
      minor.revealed = true;
      return `Only small fry on ${fullName(t)}: ${minor.description}`;
    }
    return `Rumours around ${fullName(t)}, nothing I can prove. Something is there.`;
  }
  hidden[0].revealed = true;
  return `Got it on ${fullName(t)}: ${hidden[0].description}`;
}
