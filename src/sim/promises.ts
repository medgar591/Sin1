// What the player has promised people, and what happens when it comes due.
import type { GameState, Person, PersonId, PlayerPromise, PromiseKind } from './types';
import { addLifeEvent, addLog, adjustLoyalty, adjustOpinion, adjustSatisfaction, fullName, newId, pronoun, unit } from './org';
import { roleRank } from './roles';
import { ripple } from './ties';
import { clamp } from './util';

export const PROMISE_MAX_MONTHS = 24;
export const PROMISE_LABEL: Record<PromiseKind, string> = {
  promotion: 'a promotion',
  raise: 'a raise',
  protection: 'protection',
  budget: 'more budget',
};

const RAISE_PROMISE_FRACTION = 0.1;
const BROKEN_LOYALTY = 20;
const BROKEN_OPINION = 25;
const BROKEN_FRIEND_OPINION = 6;
const KEPT_LOYALTY = 6;
const KEPT_OPINION = 8;

/** The number a promise is measured against: salary, role rank or unit budget when it was made. */
function baselineFor(state: GameState, p: Person, kind: PromiseKind): number {
  if (kind === 'raise') return p.salary;
  if (kind === 'promotion') return roleRank[p.role];
  if (kind === 'budget') return p.unitId ? unit(state, p.unitId).budget : 0;
  return 0;
}

/** Records an open promise to the person, due in `months`. Callers apply any mood effects. */
export function makePromise(state: GameState, personId: PersonId, kind: PromiseKind, months: number, detail: string): PlayerPromise {
  const promise: PlayerPromise = {
    id: newId(state, 'pr'),
    personId,
    kind,
    madeMonth: state.month,
    dueMonth: state.month + months,
    detail: detail.trim(),
    state: 'open',
    baseline: baselineFor(state, state.people[personId], kind),
  };
  state.promises.push(promise);
  return promise;
}

function fulfilled(state: GameState, pr: PlayerPromise, p: Person): boolean {
  switch (pr.kind) {
    case 'promotion':
      return roleRank[p.role] > pr.baseline;
    case 'raise':
      return p.salary >= pr.baseline * (1 + RAISE_PROMISE_FRACTION);
    case 'budget':
      return p.unitId !== null && unit(state, p.unitId).budget > pr.baseline;
    case 'protection':
      return state.month >= pr.dueMonth; // still employed when it falls due
  }
}

/** Marks promises kept or broken as their due month passes, with consequences. Run monthly. */
export function checkPromises(state: GameState): void {
  const me = state.player.personId;
  for (const pr of state.promises) {
    if (pr.state !== 'open') continue;
    const p = state.people[pr.personId];
    if (!p) { pr.state = 'broken'; continue; }
    if (p.status !== 'active') {
      // Moot once they are gone; only a protection promise to someone fired counts against the player.
      pr.state = 'broken';
      if (pr.kind === 'protection' && p.status === 'fired') {
        ripple(state, p.id, -BROKEN_FRIEND_OPINION, -3);
        addLog(state, `The CEO's promise to protect ${fullName(p)} came to nothing.`, 2, [p.id]);
      }
      continue;
    }
    if (fulfilled(state, pr, p)) {
      pr.state = 'kept';
      adjustLoyalty(state, p.id, KEPT_LOYALTY);
      adjustOpinion(state, p.id, me, KEPT_OPINION);
      addLifeEvent(state, p.id, 'promiseKept', `The CEO kept ${pronoun(p, 'possessive')} promise: ${pr.detail}`, 2, true);
      addLog(state, `Kept the promise to ${fullName(p)}: ${pr.detail}`, 1, [p.id]);
    } else if (state.month >= pr.dueMonth) {
      pr.state = 'broken';
      adjustLoyalty(state, p.id, -BROKEN_LOYALTY);
      adjustOpinion(state, p.id, me, -BROKEN_OPINION);
      adjustSatisfaction(state, p.id, -10);
      state.player.reputation = clamp(state.player.reputation - 2);
      ripple(state, p.id, -BROKEN_FRIEND_OPINION, -3);
      addLifeEvent(state, p.id, 'promiseBroken', `The CEO broke ${pronoun(p, 'possessive')} promise: ${pr.detail}`, -5, true);
      addLog(state, `Broke the promise to ${fullName(p)}: ${pr.detail}`, 2, [p.id]);
    }
  }
}
