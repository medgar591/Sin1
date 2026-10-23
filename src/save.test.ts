import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveGame, loadGame, hasSave, clearSave, exportSave, importSave } from './save';
import { smallCompany } from './sim/testkit';
import type { GameState } from './sim/types';

/** Minimal in-memory localStorage, enough for the save module. */
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const g = globalThis as unknown as { localStorage?: unknown };
let original: unknown;

beforeEach(() => {
  original = g.localStorage;
  g.localStorage = new MemoryStorage();
});

afterEach(() => {
  g.localStorage = original;
});

function sample(): GameState {
  const state = smallCompany(42).state;
  state.company.name = 'Kestrel 鄭 ㄓ Holdings';
  return state;
}

describe('localStorage round trip', () => {
  it('reports no save when nothing has been stored', () => {
    expect(hasSave()).toBe(false);
    expect(loadGame()).toBeNull();
  });

  it('saves and loads an identical state', () => {
    const state = sample();
    saveGame(state);
    expect(hasSave()).toBe(true);
    expect(loadGame()).toEqual(state);
  });

  it('overwrites an earlier save', () => {
    const first = sample();
    saveGame(first);
    const second = smallCompany(7).state;
    second.month = 12;
    saveGame(second);
    expect(loadGame()).toEqual(second);
  });

  it('clearSave removes the save', () => {
    saveGame(sample());
    clearSave();
    expect(hasSave()).toBe(false);
    expect(loadGame()).toBeNull();
  });

  it('clearSave is safe when there is nothing to clear', () => {
    expect(() => clearSave()).not.toThrow();
  });

  it('returns null for unparseable stored data', () => {
    g.localStorage = new MemoryStorage();
    (g.localStorage as MemoryStorage).setItem('sin1.save.v1', '{not json');
    expect(loadGame()).toBeNull();
    expect(hasSave()).toBe(true);
  });

  it('returns null when the stored version is not 1', () => {
    const state = { ...sample(), version: 2 };
    (g.localStorage as MemoryStorage).setItem('sin1.save.v1', JSON.stringify(state));
    expect(loadGame()).toBeNull();
  });

  it('keeps hasSave cheap: the marker answers without reading the save', () => {
    saveGame(sample());
    const ls = g.localStorage as MemoryStorage;
    const get = ls.getItem.bind(ls);
    const reads: string[] = [];
    ls.getItem = (k: string) => (reads.push(k), get(k));
    expect(hasSave()).toBe(true);
    expect(reads).toEqual(['sin1.save.v1.present']);
  });

  it('returns null when stored JSON lacks the game shape', () => {
    (g.localStorage as MemoryStorage).setItem('sin1.save.v1', JSON.stringify({ version: 1 }));
    expect(loadGame()).toBeNull();
  });
});

describe('storage failures never throw', () => {
  it('works when localStorage is missing entirely', () => {
    delete g.localStorage;
    expect(() => saveGame(sample())).not.toThrow();
    expect(loadGame()).toBeNull();
    expect(hasSave()).toBe(false);
    expect(() => clearSave()).not.toThrow();
  });

  it('works when the accessor throws', () => {
    Object.defineProperty(g, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(() => saveGame(sample())).not.toThrow();
      expect(loadGame()).toBeNull();
      expect(hasSave()).toBe(false);
      expect(() => clearSave()).not.toThrow();
    } finally {
      delete g.localStorage;
    }
  });

  it('swallows quota errors on save', () => {
    const full = new MemoryStorage();
    full.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    g.localStorage = full;
    expect(() => saveGame(sample())).not.toThrow();
  });

  it('swallows errors from getItem and removeItem', () => {
    const broken = new MemoryStorage();
    broken.getItem = () => {
      throw new Error('denied');
    };
    broken.removeItem = () => {
      throw new Error('denied');
    };
    g.localStorage = broken;
    expect(loadGame()).toBeNull();
    expect(hasSave()).toBe(false);
    expect(() => clearSave()).not.toThrow();
  });
});

/** The old uncompressed format: base64 of the UTF-8 JSON. */
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const legacyCode = (state: unknown) => b64(new TextEncoder().encode(JSON.stringify(state)));

const BAD = /doesn't look like a Sin1 save/;

describe('export and import', () => {
  it('exports the compressed format and round-trips it', async () => {
    const state = sample();
    const code = await exportSave(state);
    expect(code).toMatch(/^SIN1Z:[A-Za-z0-9+/]+={0,2}$/);
    expect(code.length).toBeLessThan(JSON.stringify(state).length / 2);
    expect(await importSave(code)).toEqual(state);
  });

  it('imports the legacy uncompressed base64 format', async () => {
    const state = sample();
    expect(await importSave(legacyCode(state))).toEqual(state);
  });

  it('imports raw JSON', async () => {
    const state = sample();
    expect(await importSave(JSON.stringify(state))).toEqual(state);
    expect(await importSave(`\n  ${JSON.stringify(state, null, 2)}  \n`)).toEqual(state);
  });

  it('preserves unicode names exactly', async () => {
    const state = sample();
    state.people[state.player.personId]!.firstName = 'ㄓ鄭 Zoë 🦅';
    for (const code of [await exportSave(state), legacyCode(state)]) {
      const round = await importSave(code);
      expect(round.people[state.player.personId]!.firstName).toBe('ㄓ鄭 Zoë 🦅');
      expect(round).toEqual(state);
    }
  });

  it('accepts a code with surrounding whitespace and line breaks', async () => {
    const state = sample();
    for (const code of [await exportSave(state), legacyCode(state)]) {
      const wrapped = `  ${code.slice(0, 20)}\n${code.slice(20, 60)}\r\n${code.slice(60)}  \n`;
      expect(await importSave(wrapped)).toEqual(state);
    }
  });

  it('falls back to the plain format when CompressionStream is missing', async () => {
    const state = sample();
    const real = globalThis.CompressionStream;
    // @ts-expect-error simulating an older browser
    delete globalThis.CompressionStream;
    try {
      const code = await exportSave(state);
      expect(code.startsWith('SIN1Z:')).toBe(false);
      expect(await importSave(code)).toEqual(state);
    } finally {
      globalThis.CompressionStream = real;
    }
  });

  it('explains when a compressed code cannot be read', async () => {
    const code = await exportSave(sample());
    const real = globalThis.DecompressionStream;
    // @ts-expect-error simulating an older browser
    delete globalThis.DecompressionStream;
    try {
      await expect(importSave(code)).rejects.toThrow(/cannot read compressed saves/);
    } finally {
      globalThis.DecompressionStream = real;
    }
  });

  it('rejects empty input', async () => {
    await expect(importSave('')).rejects.toThrow(/Paste a save code/);
    await expect(importSave('   \n\t ')).rejects.toThrow(/Paste a save code/);
  });

  it('rejects garbage with a friendly message', async () => {
    await expect(importSave('hello world!!')).rejects.toThrow(BAD);
    await expect(importSave('abc')).rejects.toThrow(BAD);
    await expect(importSave('{"not":"a save"')).rejects.toThrow(BAD);
    await expect(importSave('SIN1Z:')).rejects.toThrow(BAD);
    await expect(importSave('SIN1Z:aGVsbG8=')).rejects.toThrow(BAD); // base64, but not gzip
  });

  it('rejects valid base64 that is not a save', async () => {
    await expect(importSave(btoa(JSON.stringify({ hello: 'world' })))).rejects.toThrow(BAD);
  });

  it('rejects truncated codes', async () => {
    for (const code of [await exportSave(sample()), legacyCode(sample())]) {
      await expect(importSave(code.slice(0, code.length - 7))).rejects.toThrow(Error);
    }
  });

  it('rejects invalid UTF-8 inside valid base64', async () => {
    const code = b64(new Uint8Array([0xff, 0xfe, 0xfd, 0x80]));
    await expect(importSave(code)).rejects.toThrow(BAD);
  });

  it('rejects a save from another version with a version message', async () => {
    const state = { ...sample(), version: 2 };
    await expect(importSave(JSON.stringify(state))).rejects.toThrow(/different version/);
    await expect(importSave(legacyCode(state))).rejects.toThrow(/different version/);
    await expect(importSave(await exportSave(state as unknown as GameState))).rejects.toThrow(/different version/);
  });
});
