import { describe, it, expect, beforeEach } from 'vitest';
import {
  addRecentSearch,
  clearRecentSearches,
  readRecentSearches,
  removeRecentSearch,
  RECENT_SEARCHES_KEY,
  RECENT_SEARCHES_MAX,
} from './recentSearches';

beforeEach(() => {
  window.localStorage.clear();
});

describe('recentSearches', () => {
  it('lists the newest search first', () => {
    addRecentSearch('breaking bad');
    addRecentSearch('severance');
    expect(readRecentSearches()).toEqual(['severance', 'breaking bad']);
  });

  it('moves a repeated search to the top without a duplicate, ignoring case', () => {
    addRecentSearch('Dune');
    addRecentSearch('severance');
    addRecentSearch('dune');
    expect(readRecentSearches()).toEqual(['dune', 'severance']);
  });

  it('trims and collapses whitespace', () => {
    addRecentSearch('  the   bear ');
    expect(readRecentSearches()).toEqual(['the bear']);
  });

  it('ignores queries too short or too long to be a real search', () => {
    addRecentSearch('a');
    addRecentSearch('   ');
    addRecentSearch('x'.repeat(81));
    expect(readRecentSearches()).toEqual([]);
  });

  it('keeps only the newest entries up to the cap', () => {
    for (let i = 0; i < RECENT_SEARCHES_MAX + 3; i++) addRecentSearch(`sökning ${i}`);
    const list = readRecentSearches();
    expect(list).toHaveLength(RECENT_SEARCHES_MAX);
    expect(list[0]).toBe(`sökning ${RECENT_SEARCHES_MAX + 2}`);
    expect(list).not.toContain('sökning 0');
  });

  it('removes one entry and clears all', () => {
    addRecentSearch('dune');
    addRecentSearch('severance');
    removeRecentSearch('DUNE');
    expect(readRecentSearches()).toEqual(['severance']);
    clearRecentSearches();
    expect(readRecentSearches()).toEqual([]);
    expect(window.localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });

  it('survives corrupt stored data', () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, 'inte-json');
    expect(readRecentSearches()).toEqual([]);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ a: 1 }));
    expect(readRecentSearches()).toEqual([]);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['ok', 5, null]));
    expect(readRecentSearches()).toEqual(['ok']);
    addRecentSearch('ny');
    expect(readRecentSearches()).toEqual(['ny', 'ok']);
  });
});
