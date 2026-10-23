// Persistence for GameState. The state is plain JSON, so saving is just
// serialising it under one localStorage key. Every storage access goes through
// `withStorage`, so private mode or a full quota never throws out of this module.

import type { GameState } from './sim/types';
import { migrateState } from './sim/migrate';

const KEY = 'sin1.save.v1';
/** Tiny sibling key so `hasSave` never has to read the multi-megabyte save. */
const MARKER_KEY = 'sin1.save.v1.present';
/** The only save-format version this build reads. */
const VERSION = 1;

/** Runs `fn` against localStorage; any failure (missing, blocked, quota) yields `fallback`. */
function withStorage<T>(fn: (ls: Storage) => T, fallback: T): T {
  try {
    const ls = globalThis.localStorage;
    return ls ? fn(ls) : fallback;
  } catch {
    return fallback;
  }
}

/** Cheap structural check: enough to reject junk before the game touches it. */
function isGameState(v: Record<string, unknown>): boolean {
  return (
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

const BAD_SAVE = "That doesn't look like a Sin1 save. Check you copied the whole thing.";
const WRONG_VERSION = 'That save is from a different version of Sin1 and cannot be loaded.';

/** JSON text -> migrated state. Parses once; throws a friendly Error on anything wrong. */
function readState(json: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(BAD_SAVE);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(BAD_SAVE);
  const v = parsed as Record<string, unknown>;
  if (v.version !== undefined && v.version !== VERSION) throw new Error(WRONG_VERSION);
  if (v.version !== VERSION || !isGameState(v)) throw new Error(BAD_SAVE);
  return migrateState(parsed as GameState);
}

export function saveGame(state: GameState): void {
  withStorage((ls) => {
    ls.setItem(KEY, JSON.stringify(state));
    ls.setItem(MARKER_KEY, '1');
  }, undefined);
}

export function loadGame(): GameState | null {
  return withStorage((ls) => {
    const raw = ls.getItem(KEY);
    return raw === null ? null : readState(raw);
  }, null);
}

export function hasSave(): boolean {
  return withStorage((ls) => ls.getItem(MARKER_KEY) !== null || ls.getItem(KEY) !== null, false);
}

export function clearSave(): void {
  withStorage((ls) => {
    ls.removeItem(MARKER_KEY);
    ls.removeItem(KEY);
  }, undefined);
}

// --- Export / import -------------------------------------------------------
// Export formats, all accepted on import:
//   `SIN1Z:` + base64(gzip(UTF-8 JSON))   current; ~10x smaller than the rest
//   base64(UTF-8 JSON)                    older exports / browsers without CompressionStream
//   raw JSON                              e.g. a file opened in a text editor
// Base64 keeps it one copy-pasteable token; UTF-8 keeps non-Latin names (ㄓ, 鄭, …) intact.

const COMPRESSED_PREFIX = 'SIN1Z:';
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x1000) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x1000) as unknown as number[]));
  }
  return btoa(parts.join(''));
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

export async function exportSave(state: GameState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  if (typeof CompressionStream !== 'undefined') {
    try {
      return COMPRESSED_PREFIX + bytesToBase64(await pipeThrough(bytes, new CompressionStream('gzip')));
    } catch {
      // Fall through to the plain format.
    }
  }
  return bytesToBase64(bytes);
}

/** Turns whatever the player pasted into JSON text; throws a friendly Error if it is not a recognised format. */
async function importJsonText(text: string): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error('Paste a save code first.');
  if (trimmed.startsWith('{')) return trimmed;

  let code = trimmed.replace(/\s+/g, '');
  const compressed = code.startsWith(COMPRESSED_PREFIX);
  if (compressed) code = code.slice(COMPRESSED_PREFIX.length);
  if (!BASE64_RE.test(code) || code.length % 4 !== 0) throw new Error(BAD_SAVE);

  if (compressed && typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot read compressed saves. Export from a newer browser, or paste raw JSON.');
  }
  try {
    const bytes = base64ToBytes(code);
    return decodeUtf8(compressed ? await pipeThrough(bytes, new DecompressionStream('gzip')) : bytes);
  } catch {
    throw new Error(BAD_SAVE);
  }
}

export async function importSave(text: string): Promise<GameState> {
  return readState(await importJsonText(text));
}
