// Scripted players used by the balance harness (balance.test.ts) and for
// ad-hoc balancing runs. Not part of the game itself.
//
//  - passive:   announces suggested guidance, takes every inbox item's first
//               option, nothing else.
//  - random:    suggested guidance, splits the bonus pool, random inbox options.
//  - attentive: spends its 3 attention a month sensibly (see attentiveTurn).
import { allocateBonus, fire, hire, lobbyDirector, meet, setGuidance } from './actions';
import { suggestedGuidance } from './economy';
import { directorSupport } from './board';
import { resolveInboxItem } from './events';
import { activeStaff, isActive, opinionOf } from './org';
import { pick } from './rng';
import type { GameState, InboxItem, Person } from './types';

export type Bot = 'passive' | 'random' | 'attentive';

// ---- shared helpers ----------------------------------------------------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function recentProfit(state: GameState): number {
  return sum(state.company.history.slice(-3).map((r) => r.profit));
}

function splitBonus(state: GameState): void {
  if (state.company.bonusPool <= 0) return;
  const heads = activeStaff(state).filter((p) => p.role === 'officer' || p.role === 'divisionHead');
  const each = Math.floor(state.company.bonusPool / Math.max(1, heads.length));
  allocateBonus(state, Object.fromEntries(heads.map((p) => [p.id, each])));
}

function pending(state: GameState): InboxItem[] {
  return state.inbox.filter((it) => it.resolution === null);
}

// ---- passive / random --------------------------------------------------

export function passiveTurn(state: GameState): number {
  if (state.company.guidance === null) setGuidance(state, suggestedGuidance(state));
  let n = 0;
  for (const item of pending(state)) {
    n++;
    resolveInboxItem(state, item.id, item.options[0].id);
  }
  return n;
}

export function randomTurn(state: GameState): number {
  if (state.company.guidance === null) setGuidance(state, suggestedGuidance(state));
  splitBonus(state);
  let n = 0;
  for (const item of pending(state)) {
    n++;
    resolveInboxItem(state, item.id, pick(state, item.options).id);
  }
  return n;
}

// ---- attentive ---------------------------------------------------------

export interface BotMemory {
  lastMet: Record<string, number>;
  lastReplaced: number;
  /** Behaviours switched off, for ablation runs: guidance, bonus, inbox, seats, meet, replace, lobby. */
  off: Set<string>;
}

function avgDivisionOutput(state: GameState): number {
  const outs = Object.keys(state.divisions).map((id) => state.units[id].output);
  return outs.length ? sum(outs) / outs.length : 100;
}

function chooseOption(state: GameState, item: InboxItem): string {
  const has = (id: string) => item.options.some((o) => o.id === id);
  const subj = item.subjectIds.map((id) => state.people[id]).filter((p): p is Person => !!p);
  const s0 = subj[0];
  const attn = state.player.attentionLeft;
  const rich = state.company.cash > 5_000_000;
  switch (item.kind) {
    case 'raiseDemand':
      if (!s0) return 'refuse';
      return s0.performance >= 60 && rich ? 'grant' : s0.performance >= 45 ? 'counter' : 'refuse';
    case 'promotionDemand':
      return has('reassign') && s0 && s0.performance >= 55 ? 'reassign' : 'decline';
    case 'seatVacancy': {
      const seat = item.options.find((o) => o.id.startsWith('seat:'));
      return seat ? seat.id : 'leave';
    }
    case 'feud':
      return has('separate') ? 'separate' : 'mediate';
    case 'scheme': {
      const schemer = s0;
      if (!schemer) return 'ignore';
      const dangerous = schemer.role === 'officer' || schemer.role === 'divisionHead' || schemer.ambition >= 70;
      if (!dangerous) return 'ignore';
      if (attn >= 1 && schemer.investigatedMonth !== null && state.month - schemer.investigatedMonth <= 6 && has('confront')) return 'confront';
      if (attn >= 1) return 'investigate';
      return 'ignore';
    }
    case 'leak':
      return 'legal';
    case 'embezzlement':
      return 'legal';
    case 'scandal':
      return 'discipline';
    case 'breakthrough':
      return rich ? 'reward' : 'note';
    case 'resignationThreat':
      if (!s0) return 'letGo';
      if (s0.performance < 50 && s0.role === 'worker') return 'letGo';
      return s0.loyalty >= 65 && attn >= 1 ? 'appeal' : 'counter';
    case 'poachOffer':
      if (!s0) return 'letGo';
      if (s0.performance < 55 && s0.role === 'worker') return 'letGo';
      return s0.loyalty >= 70 && attn >= 1 ? 'appeal' : 'counter';
    case 'complaint':
      return 'file';
    case 'cliqueFormed':
      return s0 && s0.loyalty < 50 && s0.ambition >= 65 && attn >= 1 ? 'breakUp' : 'coopt';
    case 'managerFiring':
      return 'stand';
    case 'fixerFallout':
      return 'blowOver';
    case 'talentWave':
      return state.company.cash > 3_000_000 ? 'recruit' : 'pass';
    default:
      return item.options[0].id;
  }
}

export function attentiveTurn(state: GameState, mem: BotMemory): number {
  // Free actions first.
  if (state.company.guidance === null && mem.off.has('guidance')) setGuidance(state, suggestedGuidance(state));
  else if (state.company.guidance === null) {
    const monthly = state.company.history.length ? recentProfit(state) : suggestedGuidance(state);
    const downturn = (state.macro?.depth ?? 0) > 0;
    const healthy = avgDivisionOutput(state) >= 98 && state.company.boardConfidence >= 40 && !downturn;
    const target = state.company.history.length ? monthly * (healthy ? 1.03 : downturn ? 0.88 : 0.93) : monthly;
    setGuidance(state, Math.max(500_000, Math.round(target / 50_000) * 50_000));
  }
  const heads = activeStaff(state).filter((p) => p.role === 'officer' || p.role === 'divisionHead');
  if (state.company.bonusPool > 0 && mem.off.has('bonus')) splitBonus(state);
  else if (state.company.bonusPool > 0) {
    // Reward officers and division heads, weighted toward the disloyal so they stay bought.
    const weights = heads.map((p) => 1 + Math.max(0, 60 - p.loyalty) / 30);
    const w = sum(weights);
    allocateBonus(state, Object.fromEntries(heads.map((p, i) => [p.id, Math.floor((state.company.bonusPool * weights[i]) / w)])));
  }

  // Inbox.
  let n = 0;
  for (const item of pending(state).sort((a, b) => priority(b) - priority(a))) {
    n++;
    const opt = mem.off.has('inbox') ? pick(state, item.options).id : chooseOption(state, item);
    let r = resolveInboxItem(state, item.id, opt);
    if (!r.ok) r = resolveInboxItem(state, item.id, item.options[0].id);
  }

  // Proactive actions with whatever attention is left.
  // 1. Empty officer / division seats.
  for (const u of Object.values(state.units)) {
    if (state.player.attentionLeft < 1 || mem.off.has('seats')) break;
    if (u.leadId === null && (u.kind === 'function' || u.kind === 'division')) {
      hire(state, u.id, true, 'premium');
    }
  }
  // 2. Disloyal, ambitious officers: rapport (or a threat when it is already ugly).
  const risky = heads
    .filter((p) => isActive(p) && p.ambition >= 60 && p.loyalty < 50 && state.month - (mem.lastMet[p.id] ?? -99) >= 2)
    .sort((a, b) => a.loyalty - b.loyalty);
  if (risky.length && state.player.attentionLeft >= 1 && !mem.off.has('meet')) {
    const t = risky[0];
    meet(state, t.id, t.loyalty < 20 && opinionOf(state, t.id, state.player.personId) < -40 ? 'threaten' : 'rapport');
    mem.lastMet[t.id] = state.month;
  }
  // 3. Fix a unit with very low output by replacing its lead.
  if (state.player.attentionLeft >= 2 && state.month - mem.lastReplaced >= 2 && !mem.off.has('replace')) {
    const bad = Object.values(state.units)
      .filter((u) => (u.kind === 'team' || u.kind === 'subteam') && u.leadId && u.output < 70 && u.memberIds.length >= 3)
      .sort((a, b) => a.output - b.output)[0];
    if (bad) {
      const f = fire(state, bad.leadId!);
      if (f.ok) {
        hire(state, bad.id, true, 'standard');
        mem.lastReplaced = state.month;
      }
    }
  }
  // 4. Lobby the least supportive director.
  if (state.player.attentionLeft >= 1 && !mem.off.has('lobby')) {
    const dirs = state.directors.filter((d) => isActive(state.people[d.personId]));
    if (dirs.length) {
      const worst = dirs.slice().sort((a, b) => directorSupport(state, a.personId) - directorSupport(state, b.personId))[0];
      if (directorSupport(state, worst.personId) < 25 || state.month % 2 === 0) lobbyDirector(state, worst.personId, 'persuade');
    }
  }
  // 5. Anything left: keep the best-placed officer sweet.
  if (state.player.attentionLeft >= 1 && risky.length > 1 && !mem.off.has('meet')) {
    const t = risky[1];
    meet(state, t.id, 'rapport');
    mem.lastMet[t.id] = state.month;
  }
  return n;
}

function priority(item: InboxItem): number {
  const order: Record<string, number> = { scheme: 9, seatVacancy: 8, resignationThreat: 7, poachOffer: 7, embezzlement: 6, leak: 6, scandal: 6 };
  return order[item.kind] ?? 3;
}


export const newMemory = (): BotMemory => ({ lastMet: {}, lastReplaced: -99, off: new Set() });

/** Plays one month's decisions (not the advance itself); returns the inbox items handled. */
export function takeTurn(bot: Bot, state: GameState, mem: BotMemory): number {
  return bot === 'passive' ? passiveTurn(state) : bot === 'random' ? randomTurn(state) : attentiveTurn(state, mem);
}
