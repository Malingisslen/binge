import { describe, it, expect } from 'vitest';
import {
  buildToWatchRows,
  compareToWatchRows,
  lastSeenByShow,
  newestAiredDateByShow,
  toWatchGroup,
} from './toWatch';
import type { WatchlistItem } from '@/types';

const NOW = new Date(2026, 9, 30);
const mk = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1, mediaType: 'tv', status: 'mina', dropped: false, providers: [],
  addedAt: new Date(2026, 0, 1), title: 'T', posterPath: null, lastWatchedSeason: null, lastWatchedEpisode: null,
  ...over,
}) as WatchlistItem;
const none = new Set<number>();
const ctx = (over: Partial<Parameters<typeof toWatchGroup>[1]> = {}) =>
  ({ behindIds: none, newestAirDate: null, now: NOW, ...over });

describe('toWatchGroup', () => {
  it('puts a followed series with no progress under ej_paborjad', () => {
    expect(toWatchGroup(mk({}), ctx())).toBe('ej_paborjad');
  });

  it('puts a behind series under efter, or nya when an episode aired within two weeks', () => {
    const item = mk({ lastWatchedSeason: 1, lastWatchedEpisode: 3 });
    const behindIds = new Set([1]);
    expect(toWatchGroup(item, ctx({ behindIds, newestAirDate: '2026-08-01' }))).toBe('efter');
    expect(toWatchGroup(item, ctx({ behindIds, newestAirDate: '2026-10-20' }))).toBe('nya');
    expect(toWatchGroup(item, ctx({ behindIds, newestAirDate: '2026-10-10' }))).toBe('efter');
  });

  it('leaves out a started series that is not provably behind', () => {
    expect(toWatchGroup(mk({ lastWatchedSeason: 1, lastWatchedEpisode: 3 }), ctx({ newestAirDate: '2026-10-29' }))).toBeNull();
  });

  it('includes vill_se films only, and never dropped or other statuses', () => {
    expect(toWatchGroup(mk({ mediaType: 'movie', status: 'vill_se' }), ctx())).toBe('film');
    expect(toWatchGroup(mk({ mediaType: 'movie', status: 'sedd' }), ctx())).toBeNull();
    expect(toWatchGroup(mk({ status: 'sedd' }), ctx())).toBeNull();
    expect(toWatchGroup(mk({ status: 'avbruten' }), ctx())).toBeNull();
    expect(toWatchGroup(mk({ dropped: true }), ctx())).toBeNull();
  });
});

describe('lastSeenByShow and newestAiredDateByShow', () => {
  it('keeps the latest watchedAt per show', () => {
    const m = lastSeenByShow([
      { tmdbId: 1, watchedAt: new Date(2026, 5, 1) },
      { tmdbId: 1, watchedAt: new Date(2026, 7, 1) },
      { tmdbId: 2, watchedAt: new Date(2026, 6, 1) },
    ]);
    expect(m.get(1)).toEqual(new Date(2026, 7, 1));
    expect(m.get(2)).toEqual(new Date(2026, 6, 1));
  });

  it('ignores future episodes and movie releases', () => {
    const m = newestAiredDateByShow([
      { kind: 'episode', tmdbId: 1, airDate: '2026-10-01' },
      { kind: 'episode', tmdbId: 1, airDate: '2026-10-20' },
      { kind: 'episode', tmdbId: 1, airDate: '2026-11-05' },
      { kind: 'movie', tmdbId: 2, airDate: '2026-10-01' },
    ], NOW);
    expect(m.get(1)).toBe('2026-10-20');
    expect(m.has(2)).toBe(false);
  });
});

describe('compareToWatchRows', () => {
  const rows = buildToWatchRows(
    [
      mk({ tmdbId: 1, title: 'A', lastWatchedSeason: 1, lastWatchedEpisode: 1, runtime: 60 }),
      mk({ tmdbId: 2, title: 'B', lastWatchedSeason: 1, lastWatchedEpisode: 1, runtime: 30 }),
      mk({ tmdbId: 3, title: 'C' }),
    ],
    {
      behindIds: new Set([1, 2]),
      lastSeen: new Map([[1, new Date(2026, 5, 1)], [2, new Date(2026, 8, 1)]]),
      newestAired: new Map(),
      now: NOW,
    },
  );

  it('sorts by most recently seen first, rows never seen last', () => {
    expect([...rows].sort(compareToWatchRows('seen')).map(r => r.item.title)).toEqual(['B', 'A', 'C']);
  });

  it('sorts by shortest runtime first, rows without a runtime last', () => {
    expect([...rows].sort(compareToWatchRows('runtime')).map(r => r.item.title)).toEqual(['B', 'A', 'C']);
  });
});

describe('toWatchGroup edge cases', () => {
  it('counts an episode aired exactly 14 days ago as new, 15 days as not', () => {
    const item = mk({ lastWatchedSeason: 1, lastWatchedEpisode: 1 });
    const behindIds = new Set([1]);
    expect(toWatchGroup(item, ctx({ behindIds, newestAirDate: '2026-10-16' }))).toBe('nya');
    expect(toWatchGroup(item, ctx({ behindIds, newestAirDate: '2026-10-15' }))).toBe('efter');
  });

  it('puts an ended series with unseen seasons under efter without the behind set', () => {
    const item = mk({ lastWatchedSeason: 1, lastWatchedEpisode: 8, tmdbStatus: 'Ended', totalSeasons: 3 });
    expect(toWatchGroup(item, ctx())).toBe('efter');
  });
});

describe('buildToWatchRows', () => {
  it('gives films no seenAt or newestAirDate and skips dropped titles', () => {
    const rows = buildToWatchRows(
      [mk({ tmdbId: 5, mediaType: 'movie', status: 'vill_se' }), mk({ tmdbId: 6, dropped: true })],
      { behindIds: none, lastSeen: new Map([[5, new Date(2026, 1, 1)]]), newestAired: new Map([[5, '2026-10-01']]), now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ group: 'film', seenAt: null, newestAirDate: null });
  });
});

describe('compareToWatchRows other keys', () => {
  const rows = buildToWatchRows(
    [
      mk({ tmdbId: 1, title: 'B', addedAt: new Date(2026, 1, 1) }),
      mk({ tmdbId: 2, title: 'A', addedAt: new Date(2026, 3, 1) }),
    ],
    { behindIds: none, lastSeen: new Map(), newestAired: new Map(), now: NOW },
  );

  it('sorts by title A to Ö and by newest added first', () => {
    expect([...rows].sort(compareToWatchRows('title')).map(r => r.item.title)).toEqual(['A', 'B']);
    expect([...rows].sort(compareToWatchRows('added')).map(r => r.item.title)).toEqual(['A', 'B']);
  });

  it('sorts by newest aired episode with unknown dates last', () => {
    const withDates = [
      { ...rows[0], newestAirDate: '2026-10-01' },
      { ...rows[1], newestAirDate: null },
    ];
    expect([...withDates].sort(compareToWatchRows('newest')).map(r => r.item.title)).toEqual(['B', 'A']);
  });
});
