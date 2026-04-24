import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  findTopPausable,
  findCatchupCandidate,
  findIdleNextCheckDate,
  getNextAirInfo,
  isWithinDays,
  CATCHUP_THRESHOLD,
} from './useSubscriptionAdvisor.helpers';
import type {
  ProviderAdvisory,
  WatchlistItem,
  ActivePause,
  TMDBTVShow,
} from '@/types';

// --- fixtures ---

function makeProvider(overrides: Partial<ProviderAdvisory>): ProviderAdvisory {
  return {
    providerId: 8,
    providerName: 'Netflix',
    shortName: 'Netflix',
    color: '#E50914',
    monthlyCost: 149,
    status: 'active',
    nextAirDate: null,
    shows: [],
    ...overrides,
  };
}

function makePause(overrides: Partial<ActivePause> & Pick<ActivePause, 'providerId' | 'pausedAt'>): ActivePause {
  return {
    providerName: `Provider ${overrides.providerId}`,
    shortName: `P${overrides.providerId}`,
    color: '#000000',
    monthlyCost: 0,
    savingsSoFar: 0,
    resumeAt: null,
    ...overrides,
  };
}

function makeWatchlistItem(overrides: Partial<WatchlistItem>): WatchlistItem {
  return {
    tmdbId: 1,
    mediaType: 'tv',
    status: 'följer',
    rating: null,
    notes: null,
    title: 'A show',
    posterPath: null,
    releaseYear: null,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    dropped: false,
    rewatchCount: 0,
    providers: [],
    genreIds: [],
    tmdbStatus: null,
    addedAt: new Date(),
    updatedAt: new Date(),
    watchedAt: null,
    ...overrides,
  };
}

// --- findTopPausable ---

describe('findTopPausable', () => {
  it('returns nothing when there are no pause candidates', () => {
    const providers = [makeProvider({ status: 'active' })];
    expect(findTopPausable(providers, new Set())).toBeUndefined();
  });

  it('returns the highest-cost pause candidate', () => {
    const providers = [
      makeProvider({ providerId: 8, monthlyCost: 149, status: 'pause' }),
      makeProvider({ providerId: 119, monthlyCost: 69, status: 'pause' }),
      makeProvider({ providerId: 337, monthlyCost: 109, status: 'pause' }),
    ];
    const top = findTopPausable(providers, new Set());
    expect(top?.providerId).toBe(8);
  });

  it('excludes providers the user has already paused', () => {
    const providers = [
      makeProvider({ providerId: 8, monthlyCost: 149, status: 'pause' }),
      makeProvider({ providerId: 119, monthlyCost: 69, status: 'pause' }),
    ];
    const userPaused = new Set([8]);
    const top = findTopPausable(providers, userPaused);
    expect(top?.providerId).toBe(119);
  });

  it('excludes free providers (cost 0)', () => {
    // SVT Play (id 520) is free — shouldn't be suggested for pause.
    const providers = [
      makeProvider({ providerId: 520, monthlyCost: 0, status: 'pause' }),
    ];
    expect(findTopPausable(providers, new Set())).toBeUndefined();
  });

  it('excludes active providers even if they have high cost', () => {
    const providers = [makeProvider({ monthlyCost: 199, status: 'active' })];
    expect(findTopPausable(providers, new Set())).toBeUndefined();
  });
});

// --- findCatchupCandidate ---

describe('findCatchupCandidate', () => {
  function makeShow(tmdbId: number) {
    return {
      tmdbId,
      mediaType: 'tv' as const,
      title: `Show ${tmdbId}`,
      posterPath: null,
      nextAirDate: null,
      nextEpisodeCode: null,
      isEnded: false,
      releaseDate: null,
      providerIds: [],
    };
  }

  it('returns undefined when no provider has enough unfinished shows', () => {
    const providers = [
      makeProvider({
        status: 'active',
        shows: [makeShow(1), makeShow(2)],
      }),
    ];
    // Only 2 shows, CATCHUP_THRESHOLD = 3 — not enough.
    const following = new Map<number, WatchlistItem>([
      [1, makeWatchlistItem({ tmdbId: 1, lastWatchedSeason: 1 })],
      [2, makeWatchlistItem({ tmdbId: 2, lastWatchedSeason: 1 })],
    ]);
    expect(findCatchupCandidate(providers, following)).toBeUndefined();
  });

  it('returns a provider with exactly CATCHUP_THRESHOLD unfinished shows', () => {
    const providers = [
      makeProvider({
        status: 'active',
        shows: [makeShow(1), makeShow(2), makeShow(3)],
      }),
    ];
    const following = new Map<number, WatchlistItem>([
      [1, makeWatchlistItem({ tmdbId: 1, lastWatchedSeason: 1 })],
      [2, makeWatchlistItem({ tmdbId: 2, lastWatchedSeason: 1 })],
      [3, makeWatchlistItem({ tmdbId: 3, lastWatchedSeason: 2 })],
    ]);
    const result = findCatchupCandidate(providers, following);
    expect(result?.unfinishedCount).toBe(3);
  });

  it('picks the provider with the most unfinished shows when several qualify', () => {
    const providers = [
      makeProvider({
        providerId: 8,
        status: 'active',
        shows: [makeShow(1), makeShow(2), makeShow(3)],
      }),
      makeProvider({
        providerId: 119,
        status: 'active',
        shows: [makeShow(4), makeShow(5), makeShow(6), makeShow(7)],
      }),
    ];
    const following = new Map<number, WatchlistItem>([
      [1, makeWatchlistItem({ tmdbId: 1, lastWatchedSeason: 1 })],
      [2, makeWatchlistItem({ tmdbId: 2, lastWatchedSeason: 1 })],
      [3, makeWatchlistItem({ tmdbId: 3, lastWatchedSeason: 1 })],
      [4, makeWatchlistItem({ tmdbId: 4, lastWatchedSeason: 1 })],
      [5, makeWatchlistItem({ tmdbId: 5, lastWatchedSeason: 1 })],
      [6, makeWatchlistItem({ tmdbId: 6, lastWatchedSeason: 1 })],
      [7, makeWatchlistItem({ tmdbId: 7, lastWatchedSeason: 1 })],
    ]);
    const result = findCatchupCandidate(providers, following);
    expect(result?.provider.providerId).toBe(119);
    expect(result?.unfinishedCount).toBe(4);
  });

  it('ignores shows the user has never started (no lastWatchedSeason)', () => {
    const providers = [
      makeProvider({
        status: 'active',
        shows: [makeShow(1), makeShow(2), makeShow(3), makeShow(4)],
      }),
    ];
    // Only 2 of 4 have been started → below threshold.
    const following = new Map<number, WatchlistItem>([
      [1, makeWatchlistItem({ tmdbId: 1, lastWatchedSeason: 1 })],
      [2, makeWatchlistItem({ tmdbId: 2, lastWatchedSeason: null })],
      [3, makeWatchlistItem({ tmdbId: 3, lastWatchedSeason: null })],
      [4, makeWatchlistItem({ tmdbId: 4, lastWatchedSeason: 2 })],
    ]);
    expect(findCatchupCandidate(providers, following)).toBeUndefined();
  });

  it('ignores non-active providers (pause candidates)', () => {
    const providers = [
      makeProvider({
        providerId: 8,
        status: 'pause',
        shows: [makeShow(1), makeShow(2), makeShow(3)],
      }),
    ];
    const following = new Map<number, WatchlistItem>([
      [1, makeWatchlistItem({ tmdbId: 1, lastWatchedSeason: 1 })],
      [2, makeWatchlistItem({ tmdbId: 2, lastWatchedSeason: 1 })],
      [3, makeWatchlistItem({ tmdbId: 3, lastWatchedSeason: 1 })],
    ]);
    expect(findCatchupCandidate(providers, following)).toBeUndefined();
  });
});

// --- findIdleNextCheckDate ---

describe('findIdleNextCheckDate', () => {
  it('returns the earliest nextAirDate among providers', () => {
    const providers = [
      makeProvider({ providerId: 8, nextAirDate: '2026-06-01' }),
      makeProvider({ providerId: 119, nextAirDate: '2026-05-15' }),
      makeProvider({ providerId: 337, nextAirDate: '2026-07-20' }),
    ];
    expect(findIdleNextCheckDate(providers, [])).toBe('2026-05-15');
  });

  it('returns the earliest resumeAt from active pauses', () => {
    const providers: ProviderAdvisory[] = [];
    const pauses: ActivePause[] = [
      makePause({ providerId: 8, resumeAt: '2026-09-01', pausedAt: '2026-04-01' }),
      makePause({ providerId: 119, resumeAt: '2026-06-15', pausedAt: '2026-04-01' }),
    ];
    expect(findIdleNextCheckDate(providers, pauses)).toBe('2026-06-15');
  });

  it('combines provider dates + pause resumeAt and picks earliest', () => {
    const providers = [makeProvider({ nextAirDate: '2026-07-01' })];
    const pauses: ActivePause[] = [
      makePause({ providerId: 8, resumeAt: '2026-05-01', pausedAt: '2026-04-01' }),
    ];
    expect(findIdleNextCheckDate(providers, pauses)).toBe('2026-05-01');
  });

  it('returns null when there are no dates', () => {
    expect(findIdleNextCheckDate([], [])).toBe(null);
  });

  it('ignores null resumeAt values', () => {
    const pauses: ActivePause[] = [
      makePause({ providerId: 8, resumeAt: null, pausedAt: '2026-04-01' }),
    ];
    expect(findIdleNextCheckDate([], pauses)).toBe(null);
  });
});

// --- getNextAirInfo ---

describe('getNextAirInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeShow(overrides: Partial<TMDBTVShow>): TMDBTVShow {
    return {
      id: 1,
      name: 'Show',
      original_name: 'Show',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      first_air_date: '2020-01-01',
      last_air_date: '2025-01-01',
      vote_average: 0,
      vote_count: 0,
      genres: [],
      number_of_seasons: 0,
      number_of_episodes: 0,
      status: 'Returning Series',
      seasons: [],
      next_episode_to_air: null,
      last_episode_to_air: null,
      ...overrides,
    };
  }

  it('returns next_episode_to_air date + code when present', () => {
    const show = makeShow({
      next_episode_to_air: {
        id: 1,
        name: 'Next',
        season_number: 3,
        episode_number: 7,
        air_date: '2026-06-01',
        overview: '',
        still_path: null,
        vote_average: 0,
        runtime: 45,
      },
    });
    const info = getNextAirInfo(show);
    expect(info.date).toBe('2026-06-01');
    expect(info.code).toBe('S03E07');
  });

  it('falls back to future-season premiere when next_episode_to_air is null', () => {
    const show = makeShow({
      next_episode_to_air: null,
      seasons: [
        { id: 1, name: 'S1', season_number: 1, air_date: '2020-01-01', episode_count: 10, overview: '', poster_path: null },
        { id: 2, name: 'S2', season_number: 2, air_date: '2026-09-01', episode_count: 10, overview: '', poster_path: null },
      ],
    });
    const info = getNextAirInfo(show);
    expect(info.date).toBe('2026-09-01');
    expect(info.code).toBe('S02E01');
  });

  it('ignores season 0 (specials) in fallback', () => {
    const show = makeShow({
      next_episode_to_air: null,
      seasons: [
        { id: 0, name: 'Specials', season_number: 0, air_date: '2026-05-01', episode_count: 1, overview: '', poster_path: null },
        { id: 1, name: 'S1', season_number: 1, air_date: '2026-06-01', episode_count: 10, overview: '', poster_path: null },
      ],
    });
    const info = getNextAirInfo(show);
    expect(info.date).toBe('2026-06-01');
    expect(info.code).toBe('S01E01');
  });

  it('returns null/null when nothing is upcoming', () => {
    const show = makeShow({
      next_episode_to_air: null,
      seasons: [
        { id: 1, name: 'S1', season_number: 1, air_date: '2020-01-01', episode_count: 10, overview: '', poster_path: null },
      ],
    });
    const info = getNextAirInfo(show);
    expect(info.date).toBe(null);
    expect(info.code).toBe(null);
  });
});

// --- isWithinDays ---

describe('isWithinDays', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a date exactly today', () => {
    expect(isWithinDays('2026-04-20', 7)).toBe(true);
  });

  it('returns true for a date within the window', () => {
    expect(isWithinDays('2026-04-25', 7)).toBe(true);
  });

  it('returns true for a date exactly at window end', () => {
    expect(isWithinDays('2026-04-27', 7)).toBe(true);
  });

  it('returns false for a date past the window', () => {
    expect(isWithinDays('2026-04-28', 7)).toBe(false);
  });

  it('returns false for a date in the past', () => {
    expect(isWithinDays('2026-04-19', 7)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isWithinDays(null, 7)).toBe(false);
  });
});

// --- constant sanity ---

describe('CATCHUP_THRESHOLD', () => {
  it('is documented as 3', () => {
    // Locking this in: Changing the threshold is a product decision, not
    // a refactor. The test exists to catch an accidental change.
    expect(CATCHUP_THRESHOLD).toBe(3);
  });
});
