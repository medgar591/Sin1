// Tiny pure helpers shared by every sim module.
import type { ActionResult } from './types';

export const clamp = (value: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, value));

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export const average = (xs: readonly number[], fallback = 0): number => (xs.length ? sum(xs) / xs.length : fallback);

/** Rounds to the nearest multiple of `step`. */
export const roundTo = (n: number, step: number): number => Math.round(n / step) * step;

export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const ok = (message: string): ActionResult => ({ ok: true, message });
export const fail = (message: string): ActionResult => ({ ok: false, message });
