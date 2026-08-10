import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cacheInviteToken, readInviteToken, clearInviteToken, clearAllInviteTokens } from './groupInviteCache';

// BIN-844. The sweep is a new technique for this repo — nothing else enumerates
// localStorage by prefix — so the two ways to get it wrong are pinned here rather
// than left for a reviewer: removing inside an index loop (which shifts indices and
// skips every other key), and taking keys that merely contain the prefix.

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('window', {
    localStorage: {
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
  });
  // Object.keys(window.localStorage) must see the entries, which a getter-only
  // stub would hide — mirror them onto the object itself.
  Object.assign((globalThis as unknown as { window: { localStorage: object } }).window.localStorage, store);
});

describe('clearAllInviteTokens (BIN-844)', () => {
  it('removes EVERY cached invite, not every other one', () => {
    // The index-loop bug only shows with three or more: removing index 0 shifts
    // the rest down, so a naive loop reads index 1 next and skips what became 0.
    for (const g of ['g1', 'g2', 'g3', 'g4', 'g5']) cacheInviteToken(g, `token-${g}`);
    Object.assign((globalThis as unknown as { window: { localStorage: object } }).window.localStorage, store);

    clearAllInviteTokens();

    for (const g of ['g1', 'g2', 'g3', 'g4', 'g5']) expect(readInviteToken(g)).toBeNull();
  });

  it('leaves every other binge key alone', () => {
    cacheInviteToken('g1', 'secret');
    store['binge:wasLoggedIn'] = '1';
    store['binge:fcm:tokenId:u1'] = 'abc';
    store['binge-my-sessions'] = '[]';
    Object.assign((globalThis as unknown as { window: { localStorage: object } }).window.localStorage, store);

    clearAllInviteTokens();

    expect(readInviteToken('g1')).toBeNull();
    // The three keys Malin deliberately kept must survive the sweep.
    expect(store['binge:wasLoggedIn']).toBe('1');
    expect(store['binge:fcm:tokenId:u1']).toBe('abc');
    expect(store['binge-my-sessions']).toBe('[]');
  });

  it('only takes keys that START with the prefix, not ones that merely contain it', () => {
    // The header claims this is pinned; without a decoy whose prefix sits past
    // index 0, startsWith → includes survives every other case in this file.
    cacheInviteToken('g1', 'secret');
    store['x-binge:groupInvite:g9'] = 'not-ours';
    Object.assign((globalThis as unknown as { window: { localStorage: object } }).window.localStorage, store);

    clearAllInviteTokens();

    expect(readInviteToken('g1')).toBeNull();
    expect(store['x-binge:groupInvite:g9']).toBe('not-ours');
  });

  it('is a no-op on an empty store, and never throws in private mode', () => {
    expect(() => clearAllInviteTokens()).not.toThrow();
    vi.stubGlobal('window', {
      localStorage: new Proxy({}, { ownKeys() { throw new Error('SecurityError'); } }),
    });
    expect(() => clearAllInviteTokens()).not.toThrow();
  });
});

describe('groupInviteCache — the single-key helpers still behave', () => {
  it('round-trips and clears one group without touching a sibling', () => {
    cacheInviteToken('g1', 'a');
    cacheInviteToken('g2', 'b');
    expect(readInviteToken('g1')).toBe('a');
    clearInviteToken('g1');
    expect(readInviteToken('g1')).toBeNull();
    expect(readInviteToken('g2')).toBe('b');
  });
});
