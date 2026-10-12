import { describe, expect, it } from 'vitest';
import {
  averageRating, compareGroupItems, DEFAULT_GROUP_SORT, defaultGroupSortDir, sanitizeGroupSort, type GroupSortKey,
} from './groupWatchlistSort';

const item = (title: string, memberRatings: Record<string, number | null>, day = 1) =>
  ({ title, memberRatings, addedAt: new Date(2026, 0, day) }) as never;

const order = (items: never[], key: GroupSortKey, dir: 'asc' | 'desc') =>
  [...items].sort(compareGroupItems(key, dir, ['a', 'b'])).map((i: { title: string }) => i.title);

describe('compareGroupItems', () => {
  const items = [
    item('x', { a: 5, b: 1 }, 1),
    item('y', { a: 2, b: 2 }, 3),
    item('z', {}, 2),
  ];

  it('sorts a member column and keeps unrated titles last in both directions', () => {
    expect(order(items, 'member:a', 'desc')).toEqual(['x', 'y', 'z']);
    expect(order(items, 'member:a', 'asc')).toEqual(['y', 'x', 'z']);
  });

  it('sorts on the average of the ratings that exist', () => {
    expect(order(items, 'avg', 'desc')).toEqual(['x', 'y', 'z']);
    expect(order(items, 'avg', 'asc')).toEqual(['y', 'x', 'z']);
  });

  it('sorts titles and the default added order', () => {
    expect(order(items, 'title', 'asc')).toEqual(['x', 'y', 'z']);
    expect(order(items, 'title', 'desc')).toEqual(['z', 'y', 'x']);
    expect(order(items, 'addedAt', 'desc')).toEqual(['y', 'z', 'x']);
  });
});

describe('averageRating', () => {
  it('is null when nobody rated and ignores members without a rating', () => {
    expect(averageRating({ memberRatings: {} }, ['a', 'b'])).toBeNull();
    expect(averageRating({ memberRatings: { a: 4 } }, ['a', 'b'])).toBe(4);
  });
});

describe('defaultGroupSortDir', () => {
  it('starts titles ascending and ratings descending', () => {
    expect(defaultGroupSortDir('title')).toBe('asc');
    expect(defaultGroupSortDir('avg')).toBe('desc');
  });
});

describe('sanitizeGroupSort', () => {
  it('keeps a valid stored sort, including a member column', () => {
    expect(sanitizeGroupSort({ key: 'member:abc', dir: 'asc' })).toEqual({ key: 'member:abc', dir: 'asc' });
  });

  it('falls back to the default for junk', () => {
    expect(sanitizeGroupSort('x')).toEqual(DEFAULT_GROUP_SORT);
    expect(sanitizeGroupSort({ key: 'nope', dir: 'asc' })).toEqual(DEFAULT_GROUP_SORT);
    expect(sanitizeGroupSort({ key: 'avg', dir: 7 })).toEqual({ key: 'avg', dir: 'desc' });
  });
});
