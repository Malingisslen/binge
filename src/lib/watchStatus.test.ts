import { describe, it, expect } from 'vitest';
import {
  statusLabel,
  statusMenuLabel,
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
      'mina': 'Följer',
      'sedd': 'Sedd',
      'avbruten': 'Avbruten',
    });
  });
});

describe('statusOptionsFor', () => {
  it('TV menu offers mina (CTA "Följ"), sedd (genväg → mina+lastWatched), avbruten', () => {
    expect(statusOptionsFor('tv')).toEqual(['mina', 'sedd', 'avbruten']);
    // 'vill_se' är avskaffat för TV — att vilja se en serie ÄR att följa den
    // (läget 'ej_paborjad' härleds från avsaknad av progress).
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
    expect(statusLabel('avbruten')).toBe('Avbruten');
  });

  it('shows "Följer" for mina (TV)', () => {
    expect(statusLabel('mina', 'tv')).toBe('Följer');
  });

  it('translates mina → "Sedd" for movies (defensive — bör aldrig hända i normalt UI)', () => {
    expect(statusLabel('mina', 'movie')).toBe('Sedd');
  });
});

describe('statusMenuLabel', () => {
  it('uses the verb "Följ" for mina on TV (CTA), noun elsewhere', () => {
    expect(statusMenuLabel('mina', 'tv')).toBe('Följ');
    expect(statusMenuLabel('sedd', 'tv')).toBe('Sedd (alla avsnitt)');
    expect(statusMenuLabel('vill_se', 'movie')).toBe('Vill se');
    expect(statusMenuLabel('avbruten', 'tv')).toBe('Avbruten');
  });
});

describe('tvShowStatusLabel', () => {
  it('translates known TMDB statuses to Swedish', () => {
    expect(tvShowStatusLabel('Ended')).toBe('Avslutad');
    expect(tvShowStatusLabel('Returning Series')).toBe('Pågår');
    expect(tvShowStatusLabel('Canceled')).toBe('Inställd');
    expect(tvShowStatusLabel('In Production')).toBe('Under produktion');
  });

  it('translates Planned/Pilot to Swedish (BIN-335 — no English fall-through)', () => {
    expect(tvShowStatusLabel('Planned')).toBe('Planerad');
    expect(tvShowStatusLabel('Pilot')).toBe('Pilot');
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
    rewatchCount: 0, providers: [], providersCheckedAt: null, visibility: null, genreIds: [], tmdbStatus: null,
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

  it('treats season 0 (Specials) as having progress in fallback (L8)', () => {
    // lastWatchedSeason === 0 är truthy-falskt men ett giltigt progress-värde
    // (Specials). Tidigare föll detta tillbaka till "aktiv" trots Ended-status.
    const item = makeItem({ lastWatchedSeason: 0, lastWatchedEpisode: 2, tmdbStatus: 'Ended' });
    expect(tvSubState(item, undefined)).toBe('avslutad');
  });

  // BIN-335: en följd serie MED progress men där TMDB rapporterar noll aireade
  // avsnitt (last_episode_to_air === null) — t.ex. en serie som depublicerats
  // eller ännu inte fått sitt första avsnitt registrerat hos TMDB. Man kan inte
  // "ligga efter" på noll aireade avsnitt, så detta är ikapp (väntar) / avslutad
  // — aldrig "aktiv". Pinnar att isUserBehindOnAired korrekt ger false här.
  it('returns "ikapp" with TMDB show present but no aired episode + returning + progress', () => {
    const item = makeItem({ lastWatchedSeason: 1, lastWatchedEpisode: 1 });
    const show = makeShow({ last_episode_to_air: null, status: 'Returning Series' });
    expect(tvSubState(item, show)).toBe('ikapp');
  });

  it('returns "avslutad" with TMDB show present but no aired episode + ended + progress', () => {
    const item = makeItem({ lastWatchedSeason: 1, lastWatchedEpisode: 1 });
    const show = makeShow({ last_episode_to_air: null, status: 'Ended' });
    expect(tvSubState(item, show)).toBe('avslutad');
  });

  it('returns "ej_paborjad" when no progress at all, regardless of TMDB data', () => {
    const item = makeItem({ lastWatchedSeason: null, lastWatchedEpisode: null });
    const show = makeShow({ last_episode_to_air: makeEp(2, 3), status: 'Returning Series' });
    expect(tvSubState(item, show)).toBe('ej_paborjad');
  });

  it('returns "ej_paborjad" without TMDB show when no progress (ersätter gamla aktiv-fallbacken)', () => {
    const item = makeItem({ lastWatchedSeason: null, lastWatchedEpisode: null, tmdbStatus: 'Ended' });
    expect(tvSubState(item, undefined)).toBe('ej_paborjad');
  });
});

describe('SUB_STATE_LABELS', () => {
  it('has Swedish labels for each sub-state', () => {
    expect(SUB_STATE_LABELS).toEqual({
      'ej_paborjad': 'Ej påbörjad',
      'aktiv': 'Ligger efter',
      'ikapp': 'Ikapp',
      'avslutad': 'Avslutad',
    });
  });
});
