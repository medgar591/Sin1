// Seeded RNG. All simulation randomness goes through these helpers so that a
// game is fully determined by its seed and the player's choices.
import type { GameState } from './types';

/** mulberry32 step: returns [value in [0,1), next state]. */
function step(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Uniform float in [0, 1). */
export function random(state: GameState): number {
  const [value, next] = step(state.rngState);
  state.rngState = next;
  return value;
}

/** Integer in [min, max], inclusive. */
export function randInt(state: GameState, min: number, max: number): number {
  return min + Math.floor(random(state) * (max - min + 1));
}

/** True with probability p. */
export function chance(state: GameState, p: number): boolean {
  return random(state) < p;
}

export function pick<T>(state: GameState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from empty list');
  return items[Math.floor(random(state) * items.length)];
}

/** Picks by weight; weights must be >= 0 and not all zero. */
export function weightedPick<T>(state: GameState, items: readonly T[], weight: (item: T) => number): T {
  const weights = items.map(weight);
  const total = weights.reduce((a, b) => a + b, 0);
  if (items.length === 0 || total <= 0) throw new Error('weightedPick with no weight');
  let roll = random(state) * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll < 0) return items[i];
  }
  return items[items.length - 1];
}

/** Returns a new shuffled array. */
export function shuffle<T>(state: GameState, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Approximately normal, mean 0, sd 1 (sum of uniforms). */
export function gaussian(state: GameState): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += random(state);
  return (sum - 3) / Math.sqrt(0.5);
}

/** Sinless-style dice pool: counts d6 rolling 5 or 6. */
export function rollPool(state: GameState, dice: number): number {
  let hits = 0;
  for (let i = 0; i < Math.max(0, dice); i++) if (randInt(state, 1, 6) >= 5) hits++;
  return hits;
}
