import { describe, it, expect } from 'vitest';
import {
  buildToWatchRows,
  compareToWatchRows,
  lastSeenByShow,
  newestAiredDateByShow,
  availabilityOf,
  sanitizeToWatchFilters,
  sanitizeToWatchSort,
  DEFAULT_TO_WATCH_FILTERS,
  toWatchGroup,
  pickToWatchHighlights,
  agoText,
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

describe('availabilityOf', () => {
  it('tells streaming, rent or buy only, not in Sweden, and not yet checked apart', () => {
    expect(availabilityOf(mk({ providers: [8], subscriptionProviders: [8] }))).toBe('stream');
    expect(availabilityOf(mk({ providers: [10], subscriptionProviders: [] }))).toBe('rent');
    expect(availabilityOf(mk({ providers: [], providersCheckedAt: new Date(2026, 9, 1) }))).toBe('none');
    expect(availabilityOf(mk({ providers: [], providersCheckedAt: null }))).toBe('unknown');
  });
});

describe('stored view state', () => {
  it('falls back to defaults for anything unrecognised', () => {
    expect(sanitizeToWatchFilters(null)).toEqual(DEFAULT_TO_WATCH_FILTERS);
    expect(sanitizeToWatchFilters({ media: 'x', layout: 'y', service: 'abc', availability: 'z', onlyMine: 'yes' }))
      .toEqual(DEFAULT_TO_WATCH_FILTERS);
    expect(sanitizeToWatchSort('nope')).toBe('seen');
  });

  it('keeps valid stored choices', () => {
    const stored = { media: 'tv', layout: 'grouped', onlyMine: true, onlyNew: true, genre: '18', service: '8', availability: 'rent' };
    expect(sanitizeToWatchFilters(stored)).toEqual(stored);
    expect(sanitizeToWatchSort('runtime')).toBe('runtime');
  });
});

describe('pickToWatchHighlights', () => {
  const rows = buildToWatchRows(
    [
      mk({ tmdbId: 1, title: 'Ej påbörjad' }),
      mk({ tmdbId: 2, title: 'Film', mediaType: 'movie', status: 'vill_se' }),
      mk({ tmdbId: 3, title: 'Efter', lastWatchedSeason: 1, lastWatchedEpisode: 1 }),
      mk({ tmdbId: 4, title: 'Nytt', lastWatchedSeason: 1, lastWatchedEpisode: 1 }),
    ],
    {
      behindIds: new Set([3, 4]),
      lastSeen: new Map(),
      newestAired: new Map([[3, '2026-08-01'], [4, '2026-10-28']]),
      now: NOW,
    },
  );

  it('puts new episodes first, then behind, not started and films', () => {
    expect(pickToWatchHighlights(rows, 4).map(r => r.item.title)).toEqual(['Nytt', 'Efter', 'Ej påbörjad', 'Film']);
  });

  it('skips titles another tile already shows', () => {
    expect(pickToWatchHighlights(rows, 4, new Set([4])).map(r => r.item.title)).toEqual(['Efter', 'Ej påbörjad', 'Film']);
  });

  it('orders the same group by newest episode first', () => {
    const two = buildToWatchRows(
      [mk({ tmdbId: 7, title: 'Äldre', lastWatchedSeason: 1, lastWatchedEpisode: 1 }),
       mk({ tmdbId: 8, title: 'Nyare', lastWatchedSeason: 1, lastWatchedEpisode: 1 })],
      { behindIds: new Set([7, 8]), lastSeen: new Map(), newestAired: new Map([[7, '2026-10-20'], [8, '2026-10-28']]), now: NOW },
    );
    expect(pickToWatchHighlights(two).map(r => r.item.title)).toEqual(['Nyare', 'Äldre']);
  });

  it('keeps only the requested number', () => {
    expect(pickToWatchHighlights(rows, 2)).toHaveLength(2);
  });
});

describe('agoText', () => {
  it('says days under two weeks, then weeks, then months', () => {
    expect(agoText(new Date(2026, 9, 29), NOW)).toBe('i går');
    expect(agoText(new Date(2026, 9, 27), NOW)).toBe('för 3 dagar sedan');
    expect(agoText(new Date(2026, 9, 9), NOW)).toBe('för 3 veckor sedan');
    expect(agoText(new Date(2026, 6, 30), NOW)).toBe('för 3 månader sedan');
  });
});

describe('the count does not depend on what only orders or splits rows', () => {
  it('is the same whether or not newest-episode and last-seen data is known', () => {
    const items = [
      mk({ tmdbId: 1, lastWatchedSeason: 1, lastWatchedEpisode: 1 }),
      mk({ tmdbId: 2 }),
      mk({ tmdbId: 3, mediaType: 'movie', status: 'vill_se' }),
    ];
    const behindIds = new Set([1]);
    const bare = buildToWatchRows(items, { behindIds, lastSeen: new Map(), newestAired: new Map(), now: NOW });
    const full = buildToWatchRows(items, {
      behindIds, lastSeen: new Map([[1, NOW]]), newestAired: new Map([[1, '2026-10-29']]), now: NOW,
    });
    expect(bare).toHaveLength(full.length);
  });
});
