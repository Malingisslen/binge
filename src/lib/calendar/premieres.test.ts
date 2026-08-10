import { describe, it, expect } from 'vitest';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { CalendarEntry, EpisodeEntry, MovieEntry } from './types';
import type { TMDBEpisode, TMDBSearchResult, TMDBTVShow, WatchlistItem } from '@/types';
import {
  quarterWindow,
  coveredTmdbIdsInWindow,
  derivePremierePills,
  selectQuarterEvents,
  groupEntriesByMonth,
  selectDiscoveryPremieres,
  selectSeasonPremiereDiscoveries,
  mergeDiscoveries,
  QUARTER_WEEKS,
  type DiscoveryPremiere,
  type PremiereWindow,
} from './premieres';

// --- fixtures --------------------------------------------------------------

function episode(partial: Partial<EpisodeEntry> = {}): EpisodeEntry {
  return {
    kind: 'episode',
    mediaType: 'tv',
    tmdbId: 1,
    title: 'Show',
    posterPath: '/p.jpg',
    backdropPath: null,
    airDate: '2026-07-10',
    season: 2,
    episode: 5,
    episodeCode: 'S2E5',
    isPremiere: false,
    isFinale: false,
    ...partial,
  };
}

function movie(partial: Partial<MovieEntry> = {}): MovieEntry {
  return {
    kind: 'movie',
    mediaType: 'movie',
    releaseType: 'digital',
    tmdbId: 900,
    title: 'Film',
    posterPath: '/m.jpg',
    backdropPath: null,
    airDate: '2026-07-20',
    ...partial,
  };
}

function item(partial: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    tmdbId: 1,
    mediaType: 'tv',
    status: 'mina',
    rating: null,
    notes: null,
    title: 'Show',
    posterPath: '/p.jpg',
    releaseYear: null,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    dropped: false,
    rewatchCount: 0,
    providers: [],
    subscriptionProviders: null, providersCheckedAt: null,
    visibility: null,
    genreIds: [18],
    tmdbStatus: null,
    addedAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    watchedAt: null,
    ...partial,
  };
}

function searchResult(partial: Partial<TMDBSearchResult> = {}): TMDBSearchResult {
  return {
    id: 100,
    media_type: 'tv',
    name: 'Ny serie',
    poster_path: '/n.jpg',
    backdrop_path: null,
    overview: 'En ny serie.',
    vote_average: 0,
    first_air_date: '2026-08-01',
    genre_ids: [10765],
    ...partial,
  };
}

function tvEpisode(partial: Partial<TMDBEpisode> = {}): TMDBEpisode {
  return {
    id: 5000,
    episode_number: 1,
    season_number: 3,
    name: 'Premiär',
    overview: '',
    air_date: '2026-08-15',
    still_path: null,
    vote_average: 0,
    runtime: 45,
    ...partial,
  };
}

function tvShow(partial: Partial<TMDBTVShow> = {}): TMDBTVShow {
  return {
    id: 200,
    name: 'Återkomst',
    original_name: 'The Return',
    overview: 'En serie som kommer tillbaka.',
    poster_path: '/r.jpg',
    backdrop_path: null,
    first_air_date: '2022-01-01',
    last_air_date: '2025-06-01',
    vote_average: 0,
    vote_count: 0,
    genres: [{ id: 18, name: 'Drama' }],
    number_of_seasons: 3,
    number_of_episodes: 24,
    status: 'Returning Series',
    seasons: [],
    next_episode_to_air: tvEpisode(),
    last_episode_to_air: null,
    ...partial,
  };
}

const WINDOW: PremiereWindow = { startIso: '2026-07-01', endIso: '2026-10-01' };

// --- quarterWindow ---------------------------------------------------------

describe('quarterWindow', () => {
  it('spans exactly 91 calendar days, DST-safe across the autumn fall-back (BIN-105)', () => {
    // Anchor chosen so the 91-day window crosses Sweden's last-Sunday-of-October
    // fall-back (2026-10-25). Fall-back GAINS an hour, so a buggy fixed-ms diff
    // (start.getTime() + 91*86400000) lands at 2026-10-25 — one day short. The
    // calendar-day setDate stride must land exactly on 2026-10-26. Spring-forward
    // would NOT distinguish the two (it never crosses a midnight boundary), so
    // this fixture is the one that actually guards the regression.
    const w = quarterWindow(new Date(2026, 6, 27, 12, 0, 0));
    expect(w.startIso).toBe('2026-07-27');
    expect(w.endIso).toBe('2026-10-26'); // 91 days later, past the fall-back
    // sanity: 13 weeks
    expect(QUARTER_WEEKS * 7).toBe(91);
  });

  it('normalizes the start to local midnight (no time component leaks)', () => {
    const w = quarterWindow(new Date(2026, 6, 4, 23, 30, 0));
    expect(w.startIso).toBe('2026-07-04');
  });
});

// --- coveredTmdbIdsInWindow ------------------------------------------------

describe('coveredTmdbIdsInWindow', () => {
  it('collects tv ids with an episode inside [start, end), excludes movies', () => {
    const entries: CalendarEntry[] = [
      episode({ tmdbId: 1, airDate: '2026-07-10' }),
      episode({ tmdbId: 2, airDate: '2026-09-30' }),
      movie({ tmdbId: 3, airDate: '2026-08-01' }),
    ];
    const covered = coveredTmdbIdsInWindow(entries, WINDOW);
    expect(covered.has(1)).toBe(true);
    expect(covered.has(2)).toBe(true);
    expect(covered.has(3)).toBe(false); // movie never counts
  });

  it('respects the half-open bounds', () => {
    const entries: CalendarEntry[] = [
      episode({ tmdbId: 10, airDate: '2026-07-01' }), // start inclusive
      episode({ tmdbId: 11, airDate: '2026-10-01' }), // end exclusive
      episode({ tmdbId: 12, airDate: '2026-06-30' }), // before
    ];
    const covered = coveredTmdbIdsInWindow(entries, WINDOW);
    expect(covered.has(10)).toBe(true);
    expect(covered.has(11)).toBe(false);
    expect(covered.has(12)).toBe(false);
  });
});

// --- derivePremierePills ---------------------------------------------------

describe('derivePremierePills', () => {
  const covered = new Set<number>();

  it('includes an S…E1 premiere for a followed, uncovered show in-window', () => {
    const pills = derivePremierePills(
      [item({ tmdbId: 5, nextAirDate: '2026-08-15', nextAirCode: 'S3E1', nextAirProvider: 'Netflix' })],
      covered, WINDOW,
    );
    expect(pills).toHaveLength(1);
    expect(pills[0]).toMatchObject({
      tmdbId: 5, season: 3, episode: 1, episodeCode: 'S3E1',
      airDate: '2026-08-15', provider: 'Netflix', isPremiere: true, isFinale: false,
    });
  });

  it('rejects a non-premiere episode code (E5)', () => {
    const pills = derivePremierePills(
      [item({ tmdbId: 5, nextAirDate: '2026-08-15', nextAirCode: 'S3E5' })],
      covered, WINDOW,
    );
    expect(pills).toHaveLength(0);
  });

  it('rejects malformed / missing codes', () => {
    const pills = derivePremierePills([
      item({ tmdbId: 5, nextAirDate: '2026-08-15', nextAirCode: 'garbage' }),
      item({ tmdbId: 6, nextAirDate: '2026-08-15', nextAirCode: null }),
    ], covered, WINDOW);
    expect(pills).toHaveLength(0);
  });

  it('rejects dropped, vill_se, movie, out-of-window and already-covered shows', () => {
    const base = { nextAirDate: '2026-08-15', nextAirCode: 'S3E1' };
    const pills = derivePremierePills([
      item({ tmdbId: 5, dropped: true, ...base }),
      item({ tmdbId: 6, status: 'vill_se', ...base }),
      item({ tmdbId: 7, mediaType: 'movie', ...base }),
      item({ tmdbId: 8, nextAirDate: '2026-06-01', nextAirCode: 'S3E1' }), // before window
      item({ tmdbId: 9, ...base }), // covered below
    ], new Set([9]), WINDOW);
    expect(pills).toHaveLength(0);
  });

  it('passes through poster and genre fields for duotone/render', () => {
    const pills = derivePremierePills(
      [item({ tmdbId: 5, posterPath: '/x.jpg', genreIds: [16, 35], nextAirDate: '2026-08-15', nextAirCode: 'S2E1' })],
      covered, WINDOW,
    );
    expect(pills[0].posterPath).toBe('/x.jpg');
    expect(pills[0].genreIds).toEqual([16, 35]);
  });
});

// --- selectQuarterEvents ---------------------------------------------------

describe('selectQuarterEvents', () => {
  it('keeps only premieres, finales and movies inside the window', () => {
    const entries: CalendarEntry[] = [
      episode({ tmdbId: 1, episodeCode: 'S1E1', airDate: '2026-07-05', isPremiere: true }),
      episode({ tmdbId: 2, episodeCode: 'S1E7', airDate: '2026-07-06', isFinale: true }),
      episode({ tmdbId: 3, episodeCode: 'S1E4', airDate: '2026-07-07' }), // mid-run → dropped
      movie({ tmdbId: 4, airDate: '2026-07-08' }),
      episode({ tmdbId: 5, episodeCode: 'S1E1', airDate: '2026-11-01', isPremiere: true }), // out of window
    ];
    const events = selectQuarterEvents(entries, WINDOW);
    expect(events.map(e => e.tmdbId)).toEqual([1, 2, 4]);
  });

  it('dedupes on entryKey with the live entry beating the pill', () => {
    const live = episode({ tmdbId: 7, episodeCode: 'S3E1', airDate: '2026-08-01', isPremiere: true, provider: 'Live' });
    const pill = episode({ tmdbId: 7, episodeCode: 'S3E1', airDate: '2026-08-01', isPremiere: true, provider: 'Pill' });
    const events = selectQuarterEvents([live, pill], WINDOW);
    expect(events).toHaveLength(1);
    expect((events[0] as EpisodeEntry).provider).toBe('Live');
  });

  it('sorts by airDate then Swedish title', () => {
    const entries: CalendarEntry[] = [
      movie({ tmdbId: 1, title: 'Örn', airDate: '2026-08-10' }),
      movie({ tmdbId: 2, title: 'Apa', airDate: '2026-08-10' }),
      movie({ tmdbId: 3, title: 'Björn', airDate: '2026-07-01' }),
    ];
    const events = selectQuarterEvents(entries, WINDOW);
    expect(events.map(e => e.title)).toEqual(['Björn', 'Apa', 'Örn']);
  });
});

// --- groupEntriesByMonth ---------------------------------------------------

describe('groupEntriesByMonth', () => {
  it('groups by month with capitalized Swedish labels, current year unsuffixed', () => {
    const now = new Date(2026, 6, 1);
    const entries: CalendarEntry[] = [
      movie({ tmdbId: 1, airDate: '2026-07-20' }),
      movie({ tmdbId: 2, airDate: '2026-08-03' }),
    ];
    const groups = groupEntriesByMonth(entries, now);
    expect(groups.map(g => g.label)).toEqual(['Juli', 'Augusti']);
    expect(groups[0].entries).toHaveLength(1);
  });

  it('suffixes the year when the quarter crosses into the next year', () => {
    const now = new Date(2026, 11, 1); // December 2026
    const entries: CalendarEntry[] = [
      movie({ tmdbId: 1, airDate: '2026-12-20' }),
      movie({ tmdbId: 2, airDate: '2027-01-05' }),
    ];
    const groups = groupEntriesByMonth(entries, now);
    expect(groups.map(g => g.label)).toEqual(['December', 'Januari 2027']);
  });
});

// --- selectDiscoveryPremieres ----------------------------------------------

describe('selectDiscoveryPremieres', () => {
  it('drops excluded ids, out-of-window dates and posterless results', () => {
    const results: TMDBSearchResult[] = [
      searchResult({ id: 1, first_air_date: '2026-08-01' }),           // keep
      searchResult({ id: 2, first_air_date: '2026-08-01' }),           // excluded
      searchResult({ id: 3, first_air_date: '2026-11-01' }),           // out of window
      searchResult({ id: 4, first_air_date: '2026-08-01', poster_path: null }), // no poster
      searchResult({ id: 5, first_air_date: undefined }),              // no date
    ];
    const out = selectDiscoveryPremieres(results, new Set([mediaTypeDocId('tv', 2)]), WINDOW);
    expect(out.map(d => d.tmdbId)).toEqual([1]);
  });

  it('dedupes the same id across pages and preserves popularity order', () => {
    const results: TMDBSearchResult[] = [
      searchResult({ id: 10, first_air_date: '2026-07-05' }),
      searchResult({ id: 11, first_air_date: '2026-07-06' }),
      searchResult({ id: 10, first_air_date: '2026-07-05' }), // dup from page 2
    ];
    const out = selectDiscoveryPremieres(results, new Set(), WINDOW);
    expect(out.map(d => d.tmdbId)).toEqual([10, 11]);
  });

  it('caps the list length', () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      searchResult({ id: 100 + i, first_air_date: '2026-07-10' }));
    expect(selectDiscoveryPremieres(results, new Set(), WINDOW, 12)).toHaveLength(12);
  });

  it('uses getDisplayTitle — Latin original name preferred over localized', () => {
    const out = selectDiscoveryPremieres(
      [searchResult({ id: 1, name: 'Lokaliserad', original_name: 'Original Title', first_air_date: '2026-08-01' })],
      new Set(), WINDOW,
    );
    expect(out[0].title).toBe('Original Title');
  });

  it('emits the unified shape: airDate = first_air_date, seasonNumber = 1', () => {
    const out = selectDiscoveryPremieres(
      [searchResult({ id: 1, first_air_date: '2026-08-01' })],
      new Set(), WINDOW,
    );
    expect(out[0]).toMatchObject({ airDate: '2026-08-01', seasonNumber: 1 });
  });
});

// --- selectSeasonPremiereDiscoveries (Phase 2) -----------------------------

describe('selectSeasonPremiereDiscoveries', () => {
  it('keeps a returning show whose next episode is an S≥2 E1 premiere in-window', () => {
    const out = selectSeasonPremiereDiscoveries(
      [tvShow({ id: 200, next_episode_to_air: tvEpisode({ season_number: 3, episode_number: 1, air_date: '2026-08-15' }) })],
      new Set(), WINDOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      tmdbId: 200, airDate: '2026-08-15', seasonNumber: 3, title: 'The Return', posterPath: '/r.jpg',
    });
    expect(out[0].genreIds).toEqual([18]); // genres objects → id array
  });

  it('rejects a mid-season next episode (E5)', () => {
    const out = selectSeasonPremiereDiscoveries(
      [tvShow({ next_episode_to_air: tvEpisode({ season_number: 3, episode_number: 5 }) })],
      new Set(), WINDOW,
    );
    expect(out).toHaveLength(0);
  });

  it('rejects a season-1 premiere (that is Phase 1\'s lane)', () => {
    const out = selectSeasonPremiereDiscoveries(
      [tvShow({ next_episode_to_air: tvEpisode({ season_number: 1, episode_number: 1 }) })],
      new Set(), WINDOW,
    );
    expect(out).toHaveLength(0);
  });

  it('rejects missing next_episode_to_air, out-of-window, excluded and posterless shows', () => {
    const inWindowPremiere = tvEpisode({ season_number: 2, episode_number: 1, air_date: '2026-08-15' });
    const out = selectSeasonPremiereDiscoveries([
      tvShow({ id: 1, next_episode_to_air: null }),
      tvShow({ id: 2, next_episode_to_air: tvEpisode({ season_number: 2, episode_number: 1, air_date: '2026-06-01' }) }), // before window
      tvShow({ id: 3, next_episode_to_air: inWindowPremiere }), // excluded below
      tvShow({ id: 4, poster_path: null, next_episode_to_air: inWindowPremiere }),
    ], new Set([mediaTypeDocId('tv', 3)]), WINDOW);
    expect(out).toHaveLength(0);
  });

  it('caps the list length', () => {
    const shows = Array.from({ length: 20 }, (_, i) =>
      tvShow({ id: 300 + i, next_episode_to_air: tvEpisode({ season_number: 2, episode_number: 1, air_date: '2026-07-20' }) }));
    expect(selectSeasonPremiereDiscoveries(shows, new Set(), WINDOW, 12)).toHaveLength(12);
  });

  it('dedupes the same show id (e.g. across discover pages)', () => {
    const premiere = tvEpisode({ season_number: 2, episode_number: 1, air_date: '2026-07-20' });
    const shows = [
      tvShow({ id: 500, next_episode_to_air: premiere }),
      tvShow({ id: 500, next_episode_to_air: premiere }), // dup
    ];
    expect(selectSeasonPremiereDiscoveries(shows, new Set(), WINDOW)).toHaveLength(1);
  });

  it('falls back to [] genreIds when the show has no genres', () => {
    const out = selectSeasonPremiereDiscoveries(
      [tvShow({ id: 600, genres: undefined as unknown as { id: number; name: string }[],
        next_episode_to_air: tvEpisode({ season_number: 2, episode_number: 1, air_date: '2026-07-20' }) })],
      new Set(), WINDOW,
    );
    expect(out[0].genreIds).toEqual([]);
  });
});

// --- mergeDiscoveries ------------------------------------------------------

describe('mergeDiscoveries', () => {
  function disc(partial: Partial<DiscoveryPremiere>): DiscoveryPremiere {
    return {
      tmdbId: 1, title: 'X', posterPath: '/x.jpg', airDate: '2026-08-01',
      seasonNumber: 1, genreIds: [], overview: '', ...partial,
    };
  }

  it('dedupes by tmdbId with the primary (new-series) entry winning', () => {
    const merged = mergeDiscoveries(
      [disc({ tmdbId: 7, title: 'Primary', seasonNumber: 1 })],
      [disc({ tmdbId: 7, title: 'Secondary', seasonNumber: 3 })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Primary');
  });

  it('sorts the merged list by airDate then Swedish title', () => {
    const merged = mergeDiscoveries(
      [disc({ tmdbId: 1, title: 'Örn', airDate: '2026-08-10' })],
      [disc({ tmdbId: 2, title: 'Apa', airDate: '2026-08-10' }), disc({ tmdbId: 3, title: 'Björn', airDate: '2026-07-01' })],
    );
    expect(merged.map(d => d.tmdbId)).toEqual([3, 2, 1]);
  });

  it('caps the total', () => {
    const many = Array.from({ length: 10 }, (_, i) => disc({ tmdbId: i, airDate: `2026-07-${String(i + 1).padStart(2, '0')}` }));
    expect(mergeDiscoveries(many, [], 12)).toHaveLength(10);
    expect(mergeDiscoveries(many, many.map(d => disc({ ...d, tmdbId: d.tmdbId + 100 })), 12)).toHaveLength(12);
  });
});
