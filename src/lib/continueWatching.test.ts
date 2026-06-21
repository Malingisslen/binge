import { describe, it, expect } from 'vitest';
import { pickContinueWatching, latestAiredEpisodeByShow } from './continueWatching';
import type { WatchlistItem } from '@/types';
import type { CalendarEntry } from '@/lib/calendar/types';

const ep = (over: Partial<CalendarEntry> & { tmdbId: number; season: number; episode: number; airDate: string }): CalendarEntry => ({
  kind: 'episode', mediaType: 'tv', title: 'X', posterPath: null, backdropPath: null,
  episodeCode: `S${over.season}E${over.episode}`, ...over,
}) as CalendarEntry;

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
    expect(pickContinueWatching(items, { limit: 2 })).toHaveLength(2);
  });

  // === Caught-up shows must NOT clutter "Fortsätt titta" ===

  it('cheap rule: excludes a returning series caught up to the last KNOWN season', () => {
    // Every Year After / Off Campus shape: single-season series you finished,
    // TMDB still "Returning Series" so the old avslutad-check never fired.
    const caughtUp = mk({ tmdbId: 20, lastWatchedSeason: 1, lastWatchedEpisode: 8, totalSeasons: 1, tmdbStatus: 'Returning Series' });
    expect(pickContinueWatching([caughtUp])).toEqual([]);
  });

  it('cheap rule: keeps a started series whose season count is unknown (Silo/Night Agent, no calendar yet)', () => {
    // totalSeasons never backfilled → persisted fields can't prove caught-up,
    // so without calendar data we still show it (honest "don't know").
    const unknown = mk({ tmdbId: 21, lastWatchedSeason: 2, lastWatchedEpisode: 10, totalSeasons: null, tmdbStatus: 'Returning Series' });
    expect(pickContinueWatching([unknown]).map(e => e.item.tmdbId)).toEqual([21]);
  });

  it('calendar override: excludes a caught-up show even when season count is unknown', () => {
    // Silo: watched S2E10, latest aired is S2E10 → nothing to continue.
    const silo = mk({ tmdbId: 21, lastWatchedSeason: 2, lastWatchedEpisode: 10, totalSeasons: null, tmdbStatus: 'Returning Series' });
    const aired = latestAiredEpisodeByShow(
      [ep({ tmdbId: 21, season: 2, episode: 10, airDate: '2026-06-01' })],
      new Date('2026-06-21T12:00:00'),
    );
    expect(pickContinueWatching([silo], { aired })).toEqual([]);
  });

  it('calendar override: keeps a show with an aired, unwatched episode the cheap rule would have dropped', () => {
    // Förrädarna shape: on the last known season (cheap rule → caught up),
    // but S5E8 has aired and you're on S5E7 → there IS something to continue.
    const beh = mk({ tmdbId: 22, lastWatchedSeason: 5, lastWatchedEpisode: 7, totalSeasons: 5, tmdbStatus: 'Returning Series' });
    const aired = latestAiredEpisodeByShow(
      [ep({ tmdbId: 22, season: 5, episode: 8, airDate: '2026-06-15' })],
      new Date('2026-06-21T12:00:00'),
    );
    const res = pickContinueWatching([beh], { aired });
    expect(res.map(e => e.item.tmdbId)).toEqual([22]);
    // Badge stays conservative: one fresh episode on a Returning Series is not
    // a backlog, so no "Ligger efter" accent (librarySubState !== 'ligger_efter').
    expect(res[0].behind).toBe(false);
  });

  it('still flags "Ligger efter" for a genuine backlog (Ended show behind a whole season) even via the calendar path', () => {
    // Zoey's shape: Ended, totalSeasons 2, watched only through S1E12, S2E1 aired.
    const beh = mk({ tmdbId: 24, lastWatchedSeason: 1, lastWatchedEpisode: 12, totalSeasons: 2, tmdbStatus: 'Ended' });
    const aired = latestAiredEpisodeByShow(
      [ep({ tmdbId: 24, season: 2, episode: 1, airDate: '2026-05-01' })],
      new Date('2026-06-21T12:00:00'),
    );
    const res = pickContinueWatching([beh], { aired });
    expect(res.map(e => e.item.tmdbId)).toEqual([24]);
    expect(res[0].behind).toBe(true); // librarySubState === 'ligger_efter'
  });

  it('calendar override: keeps a season-only-progress show when a later episode of that season has aired', () => {
    // lastWatchedEpisode null (marked the season, episode not recorded) → treat
    // as episode 0; S2E5 aired → still ahead → kept.
    const s = mk({ tmdbId: 25, lastWatchedSeason: 2, lastWatchedEpisode: null, totalSeasons: null, tmdbStatus: 'Returning Series' });
    const aired = latestAiredEpisodeByShow(
      [ep({ tmdbId: 25, season: 2, episode: 5, airDate: '2026-06-01' })],
      new Date('2026-06-21T12:00:00'),
    );
    expect(pickContinueWatching([s], { aired }).map(e => e.item.tmdbId)).toEqual([25]);
  });

  it('calendar override: a not-yet-aired episode does not make you "behind"', () => {
    // Next episode airs in the future → still caught up, drop from the row.
    const caughtUp = mk({ tmdbId: 23, lastWatchedSeason: 2, lastWatchedEpisode: 10, totalSeasons: null, tmdbStatus: 'Returning Series' });
    const aired = latestAiredEpisodeByShow(
      [
        ep({ tmdbId: 23, season: 2, episode: 10, airDate: '2026-06-01' }),
        ep({ tmdbId: 23, season: 3, episode: 1, airDate: '2026-12-01' }), // future
      ],
      new Date('2026-06-21T12:00:00'),
    );
    expect(pickContinueWatching([caughtUp], { aired })).toEqual([]);
  });
});

describe('latestAiredEpisodeByShow', () => {
  it('returns the highest AIRED (season, episode) per show, ignoring future episodes and movies', () => {
    const now = new Date('2026-06-21T12:00:00');
    const aired = latestAiredEpisodeByShow([
      ep({ tmdbId: 1, season: 1, episode: 5, airDate: '2026-05-01' }),
      ep({ tmdbId: 1, season: 2, episode: 3, airDate: '2026-06-10' }),
      ep({ tmdbId: 1, season: 2, episode: 4, airDate: '2026-07-01' }), // future — excluded
      { kind: 'movie', mediaType: 'movie', tmdbId: 9, title: 'M', posterPath: null, backdropPath: null, airDate: '2026-06-01', releaseType: 'digital' } as CalendarEntry,
    ], now);
    expect(aired.get(1)).toEqual({ season: 2, episode: 3 });
    expect(aired.has(9)).toBe(false);
  });

  it('counts an episode airing today as aired', () => {
    const now = new Date('2026-06-21T20:00:00');
    const aired = latestAiredEpisodeByShow(
      [ep({ tmdbId: 1, season: 1, episode: 1, airDate: '2026-06-21' })],
      now,
    );
    expect(aired.get(1)).toEqual({ season: 1, episode: 1 });
  });
});
