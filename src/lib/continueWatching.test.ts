import { describe, it, expect } from 'vitest';
import { pickContinueWatching } from './continueWatching';
import type { WatchlistItem } from '@/types';

const mk = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1, mediaType: 'tv', status: 'mina', rating: null, notes: null,
  title: 'X', posterPath: null, releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], providersCheckedAt: null, visibility: null,
  genreIds: [], tmdbStatus: null,
  addedAt: new Date(2026, 0, 1), updatedAt: new Date(2026, 0, 1), watchedAt: null,
  ...over,
}) as WatchlistItem;

describe('pickContinueWatching (BIN-86)', () => {
  it('excludes films, non-mina, and not-started series', () => {
    const film = mk({ tmdbId: 1, mediaType: 'movie', status: 'sedd', lastWatchedSeason: 1 });
    const willSe = mk({ tmdbId: 2, status: 'vill_se' });
    const notStarted = mk({ tmdbId: 3, status: 'mina', lastWatchedSeason: null });
    expect(pickContinueWatching([film, willSe, notStarted])).toEqual([]);
  });

  it('includes started in-progress series with their last-seen code', () => {
    const s = mk({ tmdbId: 10, lastWatchedSeason: 2, lastWatchedEpisode: 10, tmdbStatus: 'Returning Series' });
    const res = pickContinueWatching([s]);
    expect(res).toHaveLength(1);
    expect(res[0].item.tmdbId).toBe(10);
    expect(res[0].seen).toBe('S2E10');
  });

  it('excludes finished (avslutad) series — caught up on an ended show', () => {
    const done = mk({ tmdbId: 11, lastWatchedSeason: 3, lastWatchedEpisode: 8, totalSeasons: 3, tmdbStatus: 'Ended' });
    expect(pickContinueWatching([done])).toEqual([]);
  });

  it('sorts behind (ligger_efter) first, then by most-recent activity', () => {
    // behind: Ended + behind last season
    const behind = mk({ tmdbId: 1, lastWatchedSeason: 1, lastWatchedEpisode: 2, totalSeasons: 3, tmdbStatus: 'Ended', updatedAt: new Date(2026, 0, 1) });
    // started-recent (paborjad, Returning)
    const recent = mk({ tmdbId: 2, lastWatchedSeason: 1, lastWatchedEpisode: 5, tmdbStatus: 'Returning Series', updatedAt: new Date(2026, 0, 9) });
    // started-older
    const older = mk({ tmdbId: 3, lastWatchedSeason: 1, lastWatchedEpisode: 5, tmdbStatus: 'Returning Series', updatedAt: new Date(2026, 0, 3) });
    const res = pickContinueWatching([recent, older, behind]);
    expect(res.map(e => e.item.tmdbId)).toEqual([1, 2, 3]); // behind first, then recent>older
    expect(res.map(e => e.behind)).toEqual([true, false, false]); // pin the behind flag explicitly
  });

  it('includes a started series with no lazy-backfilled tmdbStatus (common real case → paborjad)', () => {
    // User followed + watched S1E3 but never opened the title page, so
    // tmdbStatus/totalSeasons were never backfilled → librarySubState=paborjad.
    const s = mk({ tmdbId: 7, lastWatchedSeason: 1, lastWatchedEpisode: 3, tmdbStatus: null, totalSeasons: null });
    const res = pickContinueWatching([s]);
    expect(res.map(e => e.item.tmdbId)).toEqual([7]);
    expect(res[0].behind).toBe(false);
    expect(res[0].seen).toBe('S1E3');
  });

  it('caps at the limit', () => {
    const items = [1, 2, 3].map(n =>
      mk({ tmdbId: n, lastWatchedSeason: 1, lastWatchedEpisode: n, tmdbStatus: 'Returning Series', updatedAt: new Date(2026, 0, n) }));
    expect(pickContinueWatching(items, 2)).toHaveLength(2);
  });
});
