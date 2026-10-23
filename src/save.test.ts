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

describe('export and import', () => {
  it('round-trips through the export string', () => {
    const state = sample();
    const code = exportSave(state);
    expect(typeof code).toBe('string');
    expect(code).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(importSave(code)).toEqual(state);
  });

  it('preserves unicode names exactly', () => {
    const state = sample();
    state.people[state.player.personId]!.firstName = 'ㄓ鄭 Zoë 🦅';
    const round = importSave(exportSave(state));
    expect(round.people[state.player.personId]!.firstName).toBe('ㄓ鄭 Zoë 🦅');
    expect(round).toEqual(state);
  });

  it('accepts an export string with surrounding whitespace and line breaks', () => {
    const state = sample();
    const code = exportSave(state);
    const wrapped = `  ${code.slice(0, 20)}\n${code.slice(20, 60)}\r\n${code.slice(60)}  \n`;
    expect(importSave(wrapped)).toEqual(state);
  });

  it('accepts raw JSON', () => {
    const state = sample();
    expect(importSave(JSON.stringify(state))).toEqual(state);
    expect(importSave(`\n  ${JSON.stringify(state, null, 2)}  \n`)).toEqual(state);
  });

  it('rejects empty input', () => {
    expect(() => importSave('')).toThrow(/Paste a save code/);
    expect(() => importSave('   \n\t ')).toThrow(/Paste a save code/);
  });

  it('rejects garbage with a friendly message', () => {
    expect(() => importSave('hello world!!')).toThrow(/doesn't look like a Sin1 save/);
    expect(() => importSave('abc')).toThrow(/doesn't look like a Sin1 save/);
    expect(() => importSave('{"not":"a save"')).toThrow(/doesn't look like a Sin1 save/);
  });

  it('rejects valid base64 that is not a save', () => {
    const code = btoa(JSON.stringify({ hello: 'world' }));
    expect(() => importSave(code)).toThrow(/doesn't look like a Sin1 save/);
  });

  it('rejects a truncated export string', () => {
    const code = exportSave(sample());
    expect(() => importSave(code.slice(0, code.length - 7))).toThrow(Error);
  });

  it('rejects invalid UTF-8 inside valid base64', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0x80]);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    expect(() => importSave(btoa(binary))).toThrow(/doesn't look like a Sin1 save/);
  });

  it('rejects a save from another version with a version message', () => {
    const state = { ...sample(), version: 2 };
    expect(() => importSave(JSON.stringify(state))).toThrow(/different version/);
    expect(() => importSave(exportSave(state as unknown as GameState))).toThrow(/different version/);
  });
});
