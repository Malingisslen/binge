import { describe, expect, it } from 'vitest';
import {
  compareLibraryItems, DEFAULT_LIBRARY_SORT, defaultSortDir, sanitizeLibrarySort, type SortKey,
} from './librarySort';

const d = (s: string) => new Date(s);
const item = (title: string, o: Record<string, unknown> = {}) => ({
  title, rating: null, releaseYear: null, addedAt: d('2026-01-01'), updatedAt: d('2026-01-01'),
  providers: [] as number[], status: 'vill_se', watchedAt: null, ...o,
}) as never;

const titles = (items: never[], key: SortKey, dir: 'asc' | 'desc') =>
  [...items].sort(compareLibraryItems(key, dir)).map((i: { title: string }) => i.title);

describe('compareLibraryItems', () => {
  it('sorts titles A to Ö and reversed', () => {
    const items = [item('Silo'), item('Åre'), item('Andor')];
    expect(titles(items, 'title', 'asc')).toEqual(['Andor', 'Silo', 'Åre']);
    expect(titles(items, 'title', 'desc')).toEqual(['Åre', 'Silo', 'Andor']);
  });

  it('sorts by rating, year, added and updated in both directions', () => {
    const items = [
      item('a', { rating: 2, releaseYear: 2014, addedAt: d('2026-03-01'), updatedAt: d('2026-05-01') }),
      item('b', { rating: 5, releaseYear: 2023, addedAt: d('2026-01-01'), updatedAt: d('2026-06-01') }),
      item('c', { rating: 3, releaseYear: 2020, addedAt: d('2026-02-01'), updatedAt: d('2026-04-01') }),
    ];
    expect(titles(items, 'rating', 'desc')).toEqual(['b', 'c', 'a']);
    expect(titles(items, 'rating', 'asc')).toEqual(['a', 'c', 'b']);
    expect(titles(items, 'releaseYear', 'desc')).toEqual(['b', 'c', 'a']);
    expect(titles(items, 'addedAt', 'desc')).toEqual(['a', 'c', 'b']);
    expect(titles(items, 'updatedAt', 'desc')).toEqual(['b', 'a', 'c']);
  });

  it('sorts by number of services', () => {
    const items = [item('a', { providers: [1] }), item('b', { providers: [1, 2, 3] }), item('c')];
    expect(titles(items, 'providers', 'desc')).toEqual(['b', 'a', 'c']);
    expect(titles(items, 'providers', 'asc')).toEqual(['c', 'a', 'b']);
  });

  it('sorts by seen date and treats unseen rows as having none', () => {
    const items = [
      item('unseen'),
      item('old', { status: 'sedd', watchedAt: d('2025-01-01') }),
      item('new', { status: 'sedd', watchedAt: d('2026-01-01') }),
      item('dropped', { status: 'avbruten', watchedAt: d('2026-06-01') }),
    ];
    expect(titles(items, 'watchedAt', 'desc').slice(0, 2)).toEqual(['new', 'old']);
    expect(titles(items, 'watchedAt', 'asc').slice(-2)).toEqual(['old', 'new']);
  });

  it('breaks ties by title in either direction', () => {
    const items = [item('b', { rating: 4 }), item('a', { rating: 4 })];
    expect(titles(items, 'rating', 'desc')).toEqual(['a', 'b']);
    expect(titles(items, 'rating', 'asc')).toEqual(['a', 'b']);
  });
});

describe('defaultSortDir', () => {
  it('starts titles ascending and everything else descending', () => {
    expect(defaultSortDir('title')).toBe('asc');
    expect(defaultSortDir('rating')).toBe('desc');
    expect(defaultSortDir('addedAt')).toBe('desc');
  });
});

describe('sanitizeLibrarySort', () => {
  it('keeps a valid stored sort', () => {
    expect(sanitizeLibrarySort({ key: 'rating', dir: 'asc' })).toEqual({ key: 'rating', dir: 'asc' });
  });

  it('falls back to the default for junk and fills a missing direction', () => {
    expect(sanitizeLibrarySort(null)).toEqual(DEFAULT_LIBRARY_SORT);
    expect(sanitizeLibrarySort({ key: 'nope', dir: 'asc' })).toEqual(DEFAULT_LIBRARY_SORT);
    expect(sanitizeLibrarySort({ key: 'title', dir: 'sideways' })).toEqual({ key: 'title', dir: 'asc' });
  });
});
