import { describe, it, expect } from 'vitest';
import {
  statusLabel,
  STATUS_LABELS,
  TV_STATUS_OPTIONS,
  MOVIE_STATUS_OPTIONS,
  statusOptionsFor,
  tvShowStatusLabel,
  tvSubState,
  SUB_STATE_LABELS,
} from './watchStatus';
import type { TMDBTVShow, WatchlistItem } from '@/types';

describe('STATUS_LABELS', () => {
  it('contains all four WatchStatus values with new labels', () => {
    expect(STATUS_LABELS).toEqual({
      'vill_se': 'Vill se',
      'mina': 'Mina serier',
      'sedd': 'Sedd',
      'avbruten': 'Avbröt',
    });
  });
});

describe('statusOptionsFor', () => {
  it('TV menu offers vill_se, mina, avbruten — never sedd (avslutad är derived)', () => {
    expect(statusOptionsFor('tv')).toEqual(['vill_se', 'mina', 'avbruten']);
    expect(TV_STATUS_OPTIONS).not.toContain('sedd');
  });

  it('Movie menu offers vill_se, sedd, avbruten — never mina (mina är TV-only)', () => {
    expect(statusOptionsFor('movie')).toEqual(['vill_se', 'sedd', 'avbruten']);
    expect(MOVIE_STATUS_OPTIONS).not.toContain('mina');
  });
});

describe('statusLabel', () => {
  it('returns the generic label for vill_se / sedd / avbruten', () => {
    expect(statusLabel('vill_se')).toBe('Vill se');
    expect(statusLabel('sedd')).toBe('Sedd');
    expect(statusLabel('avbruten')).toBe('Avbröt');
  });

  it('shows "Mina serier" for mina (TV)', () => {
    expect(statusLabel('mina', 'tv')).toBe('Mina serier');
  });

  it('translates mina → "Sedd" for movies (defensive — bör aldrig hända i normalt UI)', () => {
    expect(statusLabel('mina', 'movie')).toBe('Sedd');
  });
});

describe('tvShowStatusLabel', () => {
  it('translates known TMDB statuses to Swedish', () => {
    expect(tvShowStatusLabel('Ended')).toBe('Avslutad');
    expect(tvShowStatusLabel('Returning Series')).toBe('Pågår');
    expect(tvShowStatusLabel('Canceled')).toBe('Inställd');
    expect(tvShowStatusLabel('In Production')).toBe('Under produktion');
  });

  it('returns the input verbatim for unknown TMDB statuses', () => {
    expect(tvShowStatusLabel('Rumored')).toBe('Rumored');
  });
});

// --- tvSubState ---

function makeItem(overrides: Partial<WatchlistItem>): WatchlistItem {
  return {
    tmdbId: 1, mediaType: 'tv', status: 'mina', rating: null, notes: null,
    title: 'X', posterPath: null, releaseYear: null, totalSeasons: null,
    lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
    rewatchCount: 0, providers: [], genreIds: [], tmdbStatus: null,
    addedAt: new Date(), updatedAt: new Date(), watchedAt: null,
    ...overrides,
  };
}

function makeShow(overrides: Partial<TMDBTVShow>): TMDBTVShow {
  return {
    id: 1, name: 'X', original_name: 'X', overview: '', poster_path: null,
    backdrop_path: null, first_air_date: '', last_air_date: '',
    vote_average: 0, vote_count: 0, genres: [], number_of_seasons: 1,
    number_of_episodes: 1, status: 'Returning Series', seasons: [],
    next_episode_to_air: null, last_episode_to_air: null,
    ...overrides,
  };
}

function makeEp(season: number, episode: number) {
  return { id: 1, episode_number: episode, season_number: season, name: '', overview: '', air_date: '2024-01-01', still_path: null, vote_average: 0, runtime: 0 };
}

describe('tvSubState', () => {
  it('returns "aktiv" when user is behind on aired episodes', () => {
    const item = makeItem({ lastWatchedSeason: 1, lastWatchedEpisode: 5 });
    const show = makeShow({ last_episode_to_air: makeEp(2, 3), status: 'Returning Series' });
    expect(tvSubState(item, show)).toBe('aktiv');
  });

  it('returns "ikapp" when caught up but show is still returning', () => {
    const item = makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 3 });
    const show = makeShow({ last_episode_to_air: makeEp(2, 3), status: 'Returning Series' });
    expect(tvSubState(item, show)).toBe('ikapp');
  });

  it('returns "avslutad" when caught up + show ended', () => {
    const item = makeItem({ lastWatchedSeason: 5, lastWatchedEpisode: 10 });
    const show = makeShow({ last_episode_to_air: makeEp(5, 10), status: 'Ended' });
    expect(tvSubState(item, show)).toBe('avslutad');
  });

  it('returns "avslutad" when caught up + show canceled', () => {
    const item = makeItem({ lastWatchedSeason: 1, lastWatchedEpisode: 8 });
    const show = makeShow({ last_episode_to_air: makeEp(1, 8), status: 'Canceled' });
    expect(tvSubState(item, show)).toBe('avslutad');
  });

  it('falls back to "avslutad" without TMDB show when stored tmdbStatus is Ended + has progress', () => {
    const item = makeItem({ lastWatchedSeason: 3, lastWatchedEpisode: 1, tmdbStatus: 'Ended' });
    expect(tvSubState(item, undefined)).toBe('avslutad');
  });

  it('falls back to "aktiv" without TMDB show for safer default', () => {
    const item = makeItem({ lastWatchedSeason: 1, lastWatchedEpisode: 1, tmdbStatus: 'Returning Series' });
    expect(tvSubState(item, undefined)).toBe('aktiv');
  });
});

describe('SUB_STATE_LABELS', () => {
  it('has Swedish labels for each sub-state', () => {
    expect(SUB_STATE_LABELS).toEqual({
      'aktiv': 'Ligger efter',
      'ikapp': 'Ikapp',
      'avslutad': 'Avslutad',
    });
  });
});
