// Tiny UI store: the GameState plus navigation state. Sim functions mutate
// the state in place, so `commit()` re-renders and schedules an autosave.
import { useEffect, useState } from 'preact/hooks';
import type { ActionResult, GameState, PersonId, UnitId } from '../sim/types';
import { saveGame } from '../save';
import type { QuarterCard, ReviewData } from './review';

/** Message text of anything thrown. */
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type Tab = 'dash' | 'org' | 'inbox' | 'board' | 'more';

export type Sheet =
  | { k: 'person'; id: PersonId }
  | { k: 'unit'; id: UnitId }
  | { k: 'bonus' }
  | { k: 'intro' }
  | { k: 'endMonth' }
  | { k: 'boardResult'; index: number; card: QuarterCard }
  | { k: 'review'; data: ReviewData }
  | { k: 'scene'; speakerId: PersonId; line: string; message: string; ok: boolean; deltas?: SceneDeltas };

/** How a face-to-face moment moved the speaker's regard for the CEO, in whole points. */
export interface SceneDeltas {
  opinion: number;
  loyalty: number;
}

export type OrgMode = 'chart' | 'players' | 'units';

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'bad';
}

interface UiState {
  game: GameState | null;
  tab: Tab;
  orgUnit: UnitId | null;
  orgMode: OrgMode;
  sheets: Sheet[];
  toast: Toast | null;
}

export const S: UiState = {
  game: null,
  tab: 'dash',
  orgUnit: null,
  orgMode: 'chart',
  sheets: [],
  toast: null,
};

const listeners = new Set<() => void>();
// Toast subscribers: notified on every change, and alone when the toast times out.
const toastListeners = new Set<() => void>();
const notify = () => {
  listeners.forEach((l) => l());
  toastListeners.forEach((l) => l());
};
const notifyToast = () => toastListeners.forEach((l) => l());

function useSubscription(set: Set<() => void>): void {
  const [, setN] = useState(0);
  useEffect(() => {
    const l = () => setN((n) => n + 1);
    set.add(l);
    return () => {
      set.delete(l);
    };
  }, []);
}

/** Subscribe a component to the store; re-renders on every change. */
export function useStore(): UiState {
  useSubscription(listeners);
  return S;
}

/** The current toast. Re-renders on every store change too (it depends on open sheets), but nothing else does when it times out. */
export function useToast(): Toast | null {
  useSubscription(toastListeners);
  return S.toast;
}

// --- Autosave --------------------------------------------------------------
// Serialising the whole state costs tens of ms, so it never sits in the tap
// path: saves are debounced, and flushed when the page is hidden or closed.

const SAVE_DELAY_MS = 400;
/** After End month: long enough for the repaint to go first, short enough to feel immediate. */
const SAVE_SOON_MS = 50;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveDirty = false;

function scheduleSave(delay: number): void {
  saveDirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, delay);
}

/** Writes any pending autosave now. */
export function flushSave(): void {
  clearTimeout(saveTimer);
  if (!saveDirty) return;
  saveDirty = false;
  if (S.game) saveGame(S.game);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  addEventListener('pagehide', flushSave);
}

export function setGame(g: GameState | null): void {
  flushSave(); // the outgoing game's pending autosave
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

/** Starts (or replaces with) a game: saves it straight away and shows it. */
export function startGame(g: GameState): void {
  flushSave();
  saveGame(g);
  setGame(g);
}

/** Call after the state was mutated: re-render now, autosave shortly (`soon`: right after the repaint). */
export function commit(soon = false): void {
  notify();
  scheduleSave(soon ? SAVE_SOON_MS : SAVE_DELAY_MS);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastSeq = 0;
export function toast(text: string, kind: 'ok' | 'bad' = 'ok'): void {
  S.toast = { id: ++toastSeq, text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    S.toast = null;
    notifyToast();
  }, 4200);
  notifyToast();
}

/** Each active person's opinion of the CEO and loyalty, to tell afterwards what an action moved. */
function regardSnapshot(g: GameState): Map<PersonId, [opinion: number, loyalty: number]> {
  const out = new Map<PersonId, [number, number]>();
  const ceo = g.player.personId;
  for (const p of Object.values(g.people)) if (p.status === 'active') out.set(p.id, [g.relations[p.id]?.[ceo]?.opinion ?? 0, p.loyalty]);
  return out;
}

function sceneDeltas(g: GameState, before: Map<PersonId, [number, number]>, id: PersonId): SceneDeltas | undefined {
  const was = before.get(id);
  const p = g.people[id];
  if (!was || !p) return undefined;
  const opinion = Math.round(g.relations[id]?.[g.player.personId]?.opinion ?? 0) - Math.round(was[0]);
  const loyalty = Math.round(p.loyalty) - Math.round(was[1]);
  return { opinion, loyalty };
}

/** Runs a sim action, toasts its message (or plays its scene, with what changed for the speaker), saves and re-renders. Returns ok. */
export function run(fn: (s: GameState) => ActionResult): boolean {
  const g = S.game;
  if (!g) return false;
  const before = regardSnapshot(g);
  try {
    const r = fn(g);
    if (r.scene) S.sheets = [...S.sheets, { k: 'scene', speakerId: r.scene.speakerId, line: r.scene.line, message: r.message, ok: r.ok, deltas: sceneDeltas(g, before, r.scene.speakerId) }];
    else toast(r.message, r.ok ? 'ok' : 'bad');
    commit();
    return r.ok;
  } catch (e) {
    toast(errMsg(e), 'bad');
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

export function goOrg(unitId: UnitId): void {
  S.orgUnit = unitId;
  S.orgMode = 'units';
  S.tab = 'org';
  S.sheets = [];
  notify();
}
export function setOrgUnit(unitId: UnitId): void {
  S.orgUnit = unitId;
  notify();
}
export function setOrgMode(m: OrgMode): void {
  S.orgMode = m;
  notify();
}
/** Opens a unit in the Units drill-down (from the chart, say). */
export function showUnit(unitId: UnitId): void {
  S.orgUnit = unitId;
  S.orgMode = 'units';
  notify();
}
