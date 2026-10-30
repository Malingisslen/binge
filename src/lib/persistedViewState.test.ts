import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  clearPersistedViewState, isPersistedViewKey, libraryFiltersKey, librarySortKey, groupSortKey,
  RECOMMENDATION_FILTERS_KEY, PERSISTED_VIEW_CLEARED_EVENT, FILTERS_PREFIX, SORT_PREFIX,
} from './persistedViewState';

// Keys that belong to the device or to a decision recorded elsewhere, and must survive a
// sign-out: the theme, an owner's invite links (Malin's 2026-08-10 call), the deletion
// marker the resume screen reads, the push pointer, the profile signature, the
// Tillsammans sessions, and the recommendation rotation (data-retention-policy.md).
const KEPT = [
  'binge:theme', 'binge:groupInvite:g1', 'binge:deletionStarted:u1', 'binge:fcm:tokenId:u1',
  'binge:pubprofile-sig:u1', 'binge:wasLoggedIn', 'binge:guestProviders',
  'binge-session-pid-s1', 'binge-my-sessions', 'binge:rec-rotation:trending',
];

describe('clearPersistedViewState', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('removes every saved filter and sort, interleaved with keys it must keep', () => {
    const doomed = [
      libraryFiltersKey('all'), librarySortKey('sedd'), groupSortKey('g1'),
      RECOMMENDATION_FILTERS_KEY, libraryFiltersKey('vill-se'),
    ];
    // Interleaved, so an index-based removal loop would skip some.
    KEPT.forEach((k, i) => {
      window.localStorage.setItem(k, '1');
      if (doomed[i]) window.localStorage.setItem(doomed[i], '{"tags":["min hemliga tagg"]}');
    });

    clearPersistedViewState();

    for (const k of doomed) expect(window.localStorage.getItem(k)).toBeNull();
    for (const k of KEPT) expect(window.localStorage.getItem(k)).toBe('1');
  });

  it('never throws when storage refuses, and still tells mounted views to reset', () => {
    window.localStorage.setItem(libraryFiltersKey(null), '{}');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    const heard = vi.fn();
    window.addEventListener(PERSISTED_VIEW_CLEARED_EVENT, heard);

    expect(() => clearPersistedViewState()).not.toThrow();
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(PERSISTED_VIEW_CLEARED_EVENT, heard);
  });

  it('never throws when localStorage itself is unreachable', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(() => clearPersistedViewState()).not.toThrow();
  });

  it('builds keys only under its own prefixes', () => {
    for (const k of [libraryFiltersKey(undefined), librarySortKey('sedd'), groupSortKey('x'), RECOMMENDATION_FILTERS_KEY]) {
      expect(isPersistedViewKey(k)).toBe(true);
    }
    for (const k of KEPT) expect(isPersistedViewKey(k)).toBe(false);
  });
});

// A key spelled out at a call site would be invisible to the sweep's single source, so the
// next saved view would be left behind on a shared browser.
describe('saved-view keys are built in one place', () => {
  const SRC = join(process.cwd(), 'src');
  const OWNER = join(SRC, 'lib', 'persistedViewState.ts');
  // The privacy page names the prefixes to the visitor; it stores nothing.
  const NAMES_THEM = join(SRC, 'app', 'integritet', 'page.tsx');
  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

  it('no production file outside persistedViewState.ts spells a saved-view prefix', () => {
    const offenders = files(SRC)
      .filter(p => /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p) && p !== OWNER && p !== NAMES_THEM)
      .filter(p => {
        const text = readFileSync(p, 'utf8');
        return text.includes(FILTERS_PREFIX) || text.includes(SORT_PREFIX);
      });
    expect(offenders).toEqual([]);
  });
});
