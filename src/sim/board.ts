// The board of directors: their stance on the CEO, quarterly meetings,
// motions and votes, including the no-confidence vote that ends the game.
import type { BoardMeeting, DirectorAgenda, DirectorInfo, GameState, Motion, MotionKind, Person, PersonId, UnitId } from './types';
import type { QuarterResult } from './economy';
import {
  activeDirectors,
  activeStaff,
  addLifeEvent,
  addLog,
  adjustOpinion,
  chainOfCommand,
  formatZuzu,
  fullName,
  newId,
  opinionOf,
  person,
  playerPerson,
  pronoun,
  quarterLabel,
  removeFromCompany,
  unit,
  unitsUnder,
} from './org';
import { chance, gaussian } from './rng';
import { endGame } from './epilogue';
import { plotProgress } from './plots';
import { issueAsks, judgeAsks } from './asks';
import { clamp, sum } from './util';

// ---- Tuning -------------------------------------------------------------

const OPINION_WEIGHT = 0.4;
const CONFIDENCE_WEIGHT = 0.8;
const AGENDA_CAP = 25;

/** Board confidence below which directors start talking about removing the CEO. */
export const NO_CONFIDENCE_LEVEL = 30;
/** No no-confidence vote in the first months unless things are catastrophic. */
const HONEYMOON_MONTHS = 6;
const CATASTROPHE_LEVEL = 15;

const PLOTTER_AMBITION = 70;
const PLOTTER_LOYALTY = 35;
const ALLY_OPINION = 35;
/** A plotting officer's allies only move against the CEO once the campaign has matured this far. */
export const PLOT_MOTION_PROGRESS = 70;
/** How hard a director's own support for the CEO weighs against the pull of a plotting officer. */
const SUPPORT_WEIGHT = 1.4;
const PLOTTER_PULL = 0.35;
/** A director votes to oust when the lean passes this. */
const OUST_THRESHOLD = 14;
/** A motion moved by a plotter's allies needs more conviction than one forced by the numbers. */
const PLOT_OUST_THRESHOLD = 24;

const BAD_OUTPUT = 80;
const WEAK_SURPRISE = -0.05;
const STRONG_SURPRISE = 0.03;
const BUDGET_CUT = 0.1;
const OLD_TENURE_MONTHS = 60;
const RECENT_MONTHS = 12;

const MAX_MOTIONS = 3;

/** Directors' opinions of the CEO relax this share of the way toward neutral every meeting: goodwill must be kept up. */
const OPINION_REVERSION = 0.06;

// ---- Evidence from the company's recent history -------------------------

/** Revenue growth between the last two quarters (or first to last month if short). */
function revenueGrowth(state: GameState): number {
  const h = state.company.history;
  if (h.length < 2) return 0;
  const revenue = (xs: typeof h) => sum(xs.map((r) => r.revenue));
  if (h.length >= 6) {
    const now = revenue(h.slice(-3));
    const before = revenue(h.slice(-6, -3));
    return before > 0 ? now / before - 1 : 0;
  }
  const first = h[0].revenue;
  return first > 0 ? h[h.length - 1].revenue / first - 1 : 0;
}

function recentProfitMargin(state: GameState): number {
  const r = state.company.history.slice(-3);
  const rev = sum(r.map((x) => x.revenue));
  return rev > 0 ? sum(r.map((x) => x.profit)) / rev : 0;
}

/** Player-caused life events in the last year, with the person they touched. */
function recentPlayerEvents(state: GameState): { p: Person; kind: string; month: number }[] {
  const out: { p: Person; kind: string; month: number }[] = [];
  for (const p of Object.values(state.people)) {
    for (const e of p.history) {
      if (e.byPlayer && state.month - e.month <= RECENT_MONTHS) out.push({ p, kind: e.kind, month: e.month });
    }
  }
  return out;
}

const CHANGE_KINDS = new Set(['hired', 'fired', 'promoted', 'demoted', 'reassigned', 'restructured']);
const PURGE_KINDS = new Set(['fired', 'demoted']);

function scandalCount(state: GameState): number {
  const re = /scandal|embezzl|leak|arrest|breach/i;
  const logged = state.log.filter((l) => state.month - l.month <= 6 && l.importance >= 2 && re.test(l.text)).length;
  const live = state.incidents.filter((i) => i.kind === 'scandal' || i.kind === 'embezzlement' || i.kind === 'leak').length;
  return logged + live;
}

/** -25..25: how the company's state sits with this director's agenda. */
function agendaScore(state: GameState, d: DirectorInfo): number {
  const co = state.company;
  switch (d.agenda) {
    case 'growth':
      return clamp(revenueGrowth(state) * 300, -AGENDA_CAP, AGENDA_CAP);
    case 'safety': {
      const monthlyCost = co.history.length ? co.history[co.history.length - 1].costs : 1_000_000;
      const months = co.cash / Math.max(1, monthlyCost);
      let s = co.cash < 0 ? -25 : months < 2 ? -15 : months > 6 ? 10 : 0;
      s -= Math.min(15, scandalCount(state) * 5);
      return clamp(s, -AGENDA_CAP, AGENDA_CAP);
    }
    case 'dividends':
      return clamp((recentProfitMargin(state) - 0.05) * 200, -AGENDA_CAP, AGENDA_CAP);
    case 'reform': {
      const n = recentPlayerEvents(state).filter((e) => CHANGE_KINDS.has(e.kind)).length;
      return clamp(n === 0 ? -10 : n * 3, -AGENDA_CAP, 20);
    }
    case 'oldGuard': {
      // Long-serving people who were fired or demoted on the CEO's order.
      const purged = recentPlayerEvents(state).filter(
        (e) => PURGE_KINDS.has(e.kind) && e.month - e.p.hiredMonth >= OLD_TENURE_MONTHS,
      ).length;
      return clamp(purged === 0 ? 5 : -purged * 8, -AGENDA_CAP, 5);
    }
  }
}

/** -100..100: how firmly this director backs the CEO right now. */
export function directorSupport(state: GameState, directorId: PersonId): number {
  const info = state.directors.find((d) => d.personId === directorId);
  const ceo = state.player.personId;
  const opinion = opinionOf(state, directorId, ceo) * OPINION_WEIGHT;
  const confidence = (state.company.boardConfidence - 50) * CONFIDENCE_WEIGHT;
  const agenda = info ? agendaScore(state, info) : 0;
  return Math.round(clamp(opinion + confidence + agenda, -100, 100));
}

// ---- Meeting ------------------------------------------------------------

function chairOf(state: GameState): Person {
  const dirs = activeDirectors(state);
  return dirs.find((d) => d.role === 'chair') ?? dirs[0];
}

function officers(state: GameState): Person[] {
  return activeStaff(state).filter((p) => p.role === 'officer');
}

/** Officers who want the CEO gone: ambitious, disloyal, with directors on side. */
function plotters(state: GameState, dirs: Person[]): { officer: Person; allies: Person[] }[] {
  const need = Math.max(2, Math.ceil(dirs.length / 2) - 1);
  const out: { officer: Person; allies: Person[] }[] = [];
  for (const o of officers(state)) {
    if (o.ambition < PLOTTER_AMBITION || o.loyalty > PLOTTER_LOYALTY) continue;
    if ((plotProgress(state, o.id) ?? 0) < PLOT_MOTION_PROGRESS) continue;
    const allies = dirs.filter((d) => opinionOf(state, d.id, o.id) >= ALLY_OPINION);
    if (allies.length >= need) out.push({ officer: o, allies });
  }
  return out.sort((a, b) => b.allies.length - a.allies.length);
}

function motion(state: GameState, kind: MotionKind, proposer: Person, targetId: string | null, summary: string): Motion {
  return { id: newId(state, 'm'), kind, proposerId: proposer.id, targetId, summary, votes: {}, passed: false };
}

/** Records votes (proposer always votes yes), the chair breaking a tie. Returns whether it passed. */
function tally(state: GameState, m: Motion, dirs: Person[], lean: (d: Person) => number): boolean {
  for (const d of dirs) m.votes[d.id] = d.id === m.proposerId ? true : lean(d) > 0;
  const yes = dirs.filter((d) => m.votes[d.id]).length;
  const no = dirs.length - yes;
  const chair = chairOf(state);
  m.passed = yes > no || (yes === no && !!chair && m.votes[chair.id]);
  return m.passed;
}

function mostHostile(state: GameState, dirs: Person[]): Person {
  return dirs.slice().sort((a, b) => directorSupport(state, a.id) - directorSupport(state, b.id))[0];
}

function divisionMargin(state: GameState, id: UnitId): number {
  const d = state.divisions[id];
  return d && d.revenue > 0 ? (d.revenue - d.costs) / d.revenue : -1;
}

function raiseNoConfidence(state: GameState, dirs: Person[]): Motion | null {
  const conf = state.company.boardConfidence;
  const plot = plotters(state, dirs)[0];
  const grace = state.month < HONEYMOON_MONTHS && conf >= CATASTROPHE_LEVEL;
  if (grace) return null;
  if (conf < NO_CONFIDENCE_LEVEL) {
    const proposer = mostHostile(state, dirs);
    const m = motion(state, 'noConfidence', proposer, plot?.officer.id ?? null, `No confidence in the CEO: board confidence stands at ${Math.round(conf)}.`);
    tally(state, m, dirs, (d) => -SUPPORT_WEIGHT * directorSupport(state, d.id) + 0.3 * opinionOf(state, d.id, proposer.id) + (plot ? PLOTTER_PULL * opinionOf(state, d.id, plot.officer.id) : 0) - OUST_THRESHOLD);
    return m;
  }
  if (plot) {
    const proposer = plot.allies.slice().sort((a, b) => opinionOf(state, b.id, plot.officer.id) - opinionOf(state, a.id, plot.officer.id))[0];
    const m = motion(state, 'noConfidence', proposer, plot.officer.id, `No confidence in the CEO, moved by a director close to ${fullName(plot.officer)}.`);
    tally(state, m, dirs, (d) => -SUPPORT_WEIGHT * directorSupport(state, d.id) + 0.3 * opinionOf(state, d.id, proposer.id) + PLOTTER_PULL * opinionOf(state, d.id, plot.officer.id) - PLOT_OUST_THRESHOLD);
    return m;
  }
  return null;
}

function raiseReplaceOfficer(state: GameState, dirs: Person[]): Motion | null {
  const outputOf = (o: Person) => (o.unitId ? unit(state, o.unitId).output : 100);
  const offs = officers(state);
  let target: Person | null = null;
  let proposer: Person | null = null;
  let candidate: Person | null = null;
  let reason = '';

  const worst = offs.slice().sort((a, b) => outputOf(a) - outputOf(b))[0];
  if (worst && outputOf(worst) < BAD_OUTPUT) {
    target = worst;
    proposer = dirs.slice().sort((a, b) => opinionOf(state, a.id, worst.id) - opinionOf(state, b.id, worst.id))[0];
    reason = `${worst.title} ${fullName(worst)} has let ${pronoun(worst, 'possessive')} function slip to ${Math.round(outputOf(worst))}% output.`;
  } else {
    // A director backing an ambitious subordinate against the officer above them.
    for (const p of activeStaff(state)) {
      if (p.ambition < 65 || p.role === 'officer' || p.role === 'ceo') continue;
      const off = chainOfCommand(state, p.id).map((id) => person(state, id)).find((x) => x.role === 'officer');
      const ally = dirs.find((d) => opinionOf(state, d.id, p.id) >= 40);
      if (off && ally && chance(state, 0.35)) {
        target = off;
        proposer = ally;
        candidate = p;
        reason = `A director wants ${fullName(p)} in the seat held by ${fullName(off)}.`;
        break;
      }
    }
  }
  if (!target || !proposer) return null;
  const t = target;
  const cand = candidate;
  const m = motion(state, 'replaceOfficer', proposer, t.id, `Replace ${t.title} ${fullName(t)}. ${reason}`);
  tally(state, m, dirs, (d) => {
    const protect = (directorSupport(state, d.id) * t.loyalty) / 1000;
    return (90 - outputOf(t)) * 0.5 - 0.3 * opinionOf(state, d.id, t.id) + 0.2 * opinionOf(state, d.id, proposer!.id) + (cand ? 0.3 * opinionOf(state, d.id, cand.id) : 0) - protect;
  });
  return m;
}

const agendaOf = (state: GameState, directorId: PersonId): DirectorAgenda | undefined =>
  state.directors.find((x) => x.personId === directorId)?.agenda;

/** Directors who favour cutting spending. */
const isHawk = (agenda: DirectorAgenda | undefined): boolean => agenda === 'safety' || agenda === 'dividends';

function raiseCutBudget(state: GameState, dirs: Person[], quarter: QuarterResult): Motion | null {
  const weak = quarter.profit <= 0 || (quarter.surprise !== null && quarter.surprise < WEAK_SURPRISE);
  if (!weak) return null;
  const divs = Object.keys(state.divisions);
  if (!divs.length) return null;
  const worst = divs.slice().sort((a, b) => divisionMargin(state, a) - divisionMargin(state, b))[0];
  const hawks = dirs.filter((d) => isHawk(agendaOf(state, d.id)));
  const proposer = (hawks.length ? hawks : dirs).slice().sort((a, b) => directorSupport(state, a.id) - directorSupport(state, b.id))[0];
  const m = motion(state, 'cutBudget', proposer, worst, `Cut ${Math.round(BUDGET_CUT * 100)}% from the budgets of ${unit(state, worst).name}, the weakest earner.`);
  tally(state, m, dirs, (d) => {
    const agenda = agendaOf(state, d.id);
    const bias = isHawk(agenda) ? 12 : agenda === 'growth' ? -12 : 0;
    return -0.5 * directorSupport(state, d.id) + bias + 0.2 * opinionOf(state, d.id, proposer.id) + 10;
  });
  return m;
}

function raiseCommend(state: GameState, dirs: Person[], quarter: QuarterResult): Motion | null {
  if (quarter.surprise === null || quarter.surprise < STRONG_SURPRISE) return null;
  const proposer = dirs.slice().sort((a, b) => directorSupport(state, b.id) - directorSupport(state, a.id))[0];
  const m = motion(state, 'commend', proposer, null, `Commend the CEO: profit of ${formatZuzu(quarter.profit)} beat guidance by ${Math.round(quarter.surprise * 100)}%.`);
  tally(state, m, dirs, (d) => directorSupport(state, d.id));
  return m;
}

function applyReplaceOfficer(state: GameState, m: Motion): void {
  const off = person(state, m.targetId!);
  const name = fullName(off);
  const title = off.title;
  removeFromCompany(state, off.id, 'fired', `Removed as ${title} on a board vote.`);
  addLifeEvent(state, off.id, 'fired', `Removed as ${title} by vote of the board.`, -8, false);
  addLog(state, `The board voted to remove ${title} ${name}. The seat is empty.`, 3, [off.id]);
}

function applyCutBudget(state: GameState, m: Motion): void {
  const u = unit(state, m.targetId!);
  for (const x of unitsUnder(state, u.id)) x.budget = Math.round(x.budget * (1 - BUDGET_CUT));
  addLog(state, `The board cut budgets in ${u.name} by ${Math.round(BUDGET_CUT * 100)}%.`, 3, u.leadId ? [u.leadId] : []);
  if (u.leadId) addLifeEvent(state, u.leadId, 'budgetCut', `The board cut the budgets of ${u.name}.`, -2, false);
}

function applyCommend(state: GameState): void {
  state.company.boardConfidence = clamp(state.company.boardConfidence + 3);
  state.player.reputation = clamp(state.player.reputation + 2);
  addLog(state, 'The board formally commended the CEO.', 2);
}

/**
 * Holds the quarterly board meeting after closeQuarter. Directors react to the
 * quarter, raise motions and vote. A passed no-confidence vote calls
 * endGame(state, 'ousted') from epilogue.ts. Pushes and returns the meeting.
 */
export function runBoardMeeting(state: GameState, quarter: QuarterResult): BoardMeeting {
  const dirs = activeDirectors(state);
  const ceo = playerPerson(state);
  const meeting: BoardMeeting = { month: state.month, motions: [], summary: '' };

  // 1. Directors' opinions follow the quarter and their own agenda.
  const confDelta = quarter.boardConfidenceAfter - quarter.boardConfidenceBefore;
  for (const d of dirs) {
    const info = state.directors.find((x) => x.personId === d.id)!;
    const delta = clamp(agendaScore(state, info) / 8 + confDelta / 3 + gaussian(state) * 0.5, -6, 6);
    const drift = -opinionOf(state, d.id, ceo.id) * OPINION_REVERSION;
    adjustOpinion(state, d.id, ceo.id, Math.round((delta + drift) * 10) / 10);
  }

  // The directors' asks for the quarter are judged on the figures just closed.
  const asks = judgeAsks(state);
  if (asks.length) meeting.asks = asks;

  // 2. Motions.
  const noConf = dirs.length ? raiseNoConfidence(state, dirs) : null;
  const motions: Motion[] = [];
  if (dirs.length && !noConf) {
    const others = [raiseReplaceOfficer(state, dirs), raiseCutBudget(state, dirs, quarter), raiseCommend(state, dirs, quarter)];
    for (const m of others) if (m && motions.length < MAX_MOTIONS) motions.push(m);
  }
  if (noConf) motions.push(noConf);

  // 3. Apply results.
  const lines: string[] = [];
  if (asks.length) lines.push(`Directors' asks: ${asks.filter((a) => a.met).length} of ${asks.length} met.`);
  for (const m of motions) {
    const yes = Object.values(m.votes).filter(Boolean).length;
    const no = dirs.length - yes;
    lines.push(`${m.summary} ${m.passed ? 'Passed' : 'Failed'} ${yes}-${no}.`);
    if (!m.passed) continue;
    if (m.kind === 'replaceOfficer') applyReplaceOfficer(state, m);
    else if (m.kind === 'cutBudget') applyCutBudget(state, m);
    else if (m.kind === 'commend') applyCommend(state);
  }
  // The headline comes last so the confidence it quotes is where the asks and motions left it.
  const q = quarterLabel(quarter.month);
  const pct = quarter.surprise === null ? 0 : Math.round(quarter.surprise * 100);
  const g = quarter.surprise === null ? 'with no guidance given' : pct === 0 ? 'in line with guidance' : `${pct > 0 ? 'beating' : 'missing'} guidance by ${Math.abs(pct)}%`;
  lines.unshift(`${q}: profit ${formatZuzu(quarter.profit)}, ${g}. Board confidence ${Math.round(state.company.boardConfidence)}.`);
  meeting.motions = motions;
  meeting.summary = lines.join(' ');
  state.boardMeetings.push(meeting);
  addLog(state, `Board meeting: ${meeting.summary}`, 3);

  if (noConf?.passed) {
    addLog(state, 'The board passed a vote of no confidence. The CEO is out.', 3, [ceo.id]);
    endGame(state, 'ousted');
  }
  if (!state.gameOver) issueAsks(state);
  return meeting;
}
