// Persistence for GameState. The state is plain JSON, so saving is just
// serialising it under one localStorage key. Every storage access is wrapped
// so private mode or a full quota never throws out of this module.

import type { GameState } from './sim/types';

const KEY = 'sin1.save.v1';
const VERSION = 1;

function storage(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

/** Cheap structural check: enough to reject junk before the game touches it. */
function isGameState(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === VERSION &&
    typeof v.seed === 'number' &&
    typeof v.rngState === 'number' &&
    typeof v.month === 'number' &&
    typeof v.company === 'object' && v.company !== null &&
    typeof v.player === 'object' && v.player !== null &&
    typeof v.people === 'object' && v.people !== null &&
    typeof v.units === 'object' && v.units !== null &&
    typeof v.divisions === 'object' && v.divisions !== null &&
    typeof v.relations === 'object' && v.relations !== null &&
    typeof v.cliques === 'object' && v.cliques !== null &&
    Array.isArray(v.directors) &&
    Array.isArray(v.inbox) &&
    Array.isArray(v.log)
  );
}

function parseState(text: string): GameState | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isGameState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or storage blocked: the game carries on without saving.
  }
}

export function loadGame(): GameState | null {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(KEY);
    if (raw === null) return null;
    return parseState(raw);
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    return ls.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.removeItem(KEY);
  } catch {
    // Nothing to do: the key stays, and loadGame will simply read it again.
  }
}

// --- Export / import -------------------------------------------------------
// The export string is base64 of the UTF-8 JSON. Base64 keeps it to one
// copy-pasteable token; the UTF-8 step keeps non-Latin names (ㄓ, 鄭, …) intact.

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function exportSave(state: GameState): string {
  return utf8ToBase64(JSON.stringify(state));
}

const BAD_SAVE = "That doesn't look like a Sin1 save. Check you copied the whole thing.";
const WRONG_VERSION = 'That save is from a different version of Sin1 and cannot be loaded.';

export function importSave(text: string): GameState {
  const trimmed = text.replace(/\s+/g, '');
  if (trimmed.length === 0) {
    throw new Error('Paste a save code first.');
  }

  // Raw JSON, e.g. a file the player opened in a text editor.
  if (trimmed.startsWith('{')) {
    const state = parseState(text.trim());
    if (state) return state;
    const version = tryVersion(text.trim());
    if (version !== undefined && version !== VERSION) throw new Error(WRONG_VERSION);
    throw new Error(BAD_SAVE);
  }

  if (!BASE64_RE.test(trimmed) || trimmed.length % 4 !== 0) {
    throw new Error(BAD_SAVE);
  }

  let json: string;
  try {
    json = base64ToUtf8(trimmed);
  } catch {
    throw new Error(BAD_SAVE);
  }

  const state = parseState(json);
  if (state) return state;
  const version = tryVersion(json);
  if (version !== undefined && version !== VERSION) throw new Error(WRONG_VERSION);
  throw new Error(BAD_SAVE);
}

function tryVersion(json: string): unknown {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      return (parsed as { version: unknown }).version;
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return undefined;
}
