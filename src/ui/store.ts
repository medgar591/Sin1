// Tiny UI store: the GameState plus navigation state. Sim functions mutate
// the state in place, so `commit()` bumps a version and re-renders.
import { useEffect, useState } from 'preact/hooks';
import type { ActionResult, GameState, PersonId, UnitId } from '../sim/types';
import { saveGame } from '../save';

export type Tab = 'dash' | 'org' | 'inbox' | 'board' | 'more';

export type Sheet =
  | { k: 'person'; id: PersonId }
  | { k: 'unit'; id: UnitId }
  | { k: 'bonus' }
  | { k: 'endMonth' }
  | { k: 'boardResult'; index: number };

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'bad';
}

interface UiState {
  game: GameState | null;
  version: number;
  tab: Tab;
  orgUnit: UnitId | null;
  sheets: Sheet[];
  toast: Toast | null;
}

export const S: UiState = {
  game: null,
  version: 0,
  tab: 'dash',
  orgUnit: null,
  sheets: [],
  toast: null,
};

const listeners = new Set<() => void>();
const notify = () => {
  S.version++;
  listeners.forEach((l) => l());
};

/** Subscribe a component to the store; re-renders on every change. */
export function useStore(): UiState {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return S;
}

export function setGame(g: GameState | null): void {
  S.game = g;
  S.tab = 'dash';
  S.orgUnit = g ? g.rootUnitId : null;
  S.sheets = [];
  S.toast = null;
  notify();
}

export function game(): GameState {
  if (!S.game) throw new Error('no game');
  return S.game;
}

/** Call after the state was mutated: re-render and autosave. */
export function commit(): void {
  if (S.game) saveGame(S.game);
  notify();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastSeq = 0;
export function toast(text: string, kind: 'ok' | 'bad' = 'ok'): void {
  S.toast = { id: ++toastSeq, text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    S.toast = null;
    notify();
  }, 4200);
  notify();
}

/** Runs a sim action, toasts its message, saves and re-renders. Returns ok. */
export function run(fn: (s: GameState) => ActionResult): boolean {
  const g = S.game;
  if (!g) return false;
  try {
    const r = fn(g);
    toast(r.message, r.ok ? 'ok' : 'bad');
    commit();
    return r.ok;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'bad');
    commit();
    return false;
  }
}

export function setTab(t: Tab): void {
  S.tab = t;
  S.sheets = [];
  notify();
}

export function openSheet(s: Sheet): void {
  S.sheets = [...S.sheets, s];
  notify();
}
export const openPerson = (id: PersonId) => openSheet({ k: 'person', id });
export const openUnit = (id: UnitId) => openSheet({ k: 'unit', id });
export function closeSheet(): void {
  S.sheets = S.sheets.slice(0, -1);
  notify();
}
export function closeAllSheets(): void {
  S.sheets = [];
  notify();
}

export function goOrg(unitId: UnitId): void {
  S.orgUnit = unitId;
  S.tab = 'org';
  S.sheets = [];
  notify();
}
export function setOrgUnit(unitId: UnitId): void {
  S.orgUnit = unitId;
  notify();
}
