import { describe, it, expect } from 'vitest';
import { buildCalendarEntries, buildMovieEntries, type SeasonDatum } from './buildEntries';
import type { TMDBTVShow, TMDBEpisode, TMDBMovie } from '@/types';
import type { EpisodeEntry, MovieEntry } from './types';
import { latestAiredEpisodeByShow } from '@/lib/continueWatching';

function ep(partial: Partial<TMDBEpisode>): TMDBEpisode {
  return {
    id: 1, episode_number: 1, season_number: 1, name: 'Ep', overview: '',
    air_date: '2026-05-25', still_path: null, vote_average: 0, runtime: 44,
    ...partial,
  };
}

function show(partial: Partial<TMDBTVShow>): TMDBTVShow {
  return {
    id: 100, name: 'Test Show', original_name: 'Test Show', number_of_seasons: 4,
    poster_path: '/p.jpg', backdrop_path: '/b.jpg', genres: [{ id: 18, name: 'Drama' }],
    status: 'Returning Series', seasons: [], next_episode_to_air: null,
    last_episode_to_air: null,
    'watch/providers': { results: { SE: { flatrate: [] } } },
    ...partial,
  } as TMDBTVShow;
}

// Narrowar union → EpisodeEntry för avsnitts-assertions.
function eps(entries: (EpisodeEntry | MovieEntry)[]): EpisodeEntry[] {
  return entries.filter((e): e is EpisodeEntry => e.kind === 'episode');
}

describe('buildCalendarEntries', () => {
  it('seeds an entry from next_episode_to_air when the season array lacks it', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: ep({ season_number: 4, episode_number: 10, air_date: '2026-05-31', name: 'Finale' }) }),
      season: { episodes: [ep({ season_number: 4, episode_number: 9, air_date: '2026-05-24' })] },
    }];
    const entries = eps(buildCalendarEntries(data));
    const upcoming = entries.find(e => e.season === 4 && e.episode === 10);
    expect(upcoming).toBeDefined();
    expect(upcoming!.airDate).toBe('2026-05-31');
  });

  it('does not duplicate when the season array already contains the upcoming episode', () => {
    const e10 = ep({ season_number: 4, episode_number: 10, air_date: '2026-05-31' });
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: e10 }),
      season: { episodes: [e10] },
    }];
    const entries = eps(buildCalendarEntries(data));
    expect(entries.filter(e => e.season === 4 && e.episode === 10)).toHaveLength(1);
  });

  it('handles a null next_episode_to_air without crashing', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: null }),
      season: { episodes: [ep({ episode_number: 1, air_date: '2026-05-26' })] },
    }];
    expect(buildCalendarEntries(data)).toHaveLength(1);
  });

  it('skips episodes with no air_date', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: null }),
      season: { episodes: [ep({ episode_number: 1, air_date: '' })] },
    }];
    expect(buildCalendarEntries(data)).toHaveLength(0);
  });

  // TMDBSeason-fixture för isFinale-korskoll (BIN-13).
  const seasonMeta = (season_number: number, episode_count: number) => ({
    id: season_number, season_number, episode_count,
    name: `Säsong ${season_number}`, overview: '', poster_path: null, air_date: '2026-05-01',
  });

  it('marks the seeded finale episode isFinale when the season array lags but the listing is known-complete', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({
        // Säsongen har 10 avsnitt totalt; arrayen släpar (bara E9), E10 seedas.
        seasons: [seasonMeta(4, 10)],
        next_episode_to_air: ep({ season_number: 4, episode_number: 10, air_date: '2026-05-31' }),
      }),
      season: { episodes: [ep({ season_number: 4, episode_number: 9, air_date: '2026-05-24' })] },
    }];
    const seeded = eps(buildCalendarEntries(data)).find(e => e.episode === 10);
    expect(seeded?.isFinale).toBe(true);
  });

  it('does NOT flag a mid-run episode as finale when the season listing trails episode_count (BIN-13)', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({
        // Säsongen har 20 avsnitt men TMDB:s array släpar (E9 + seedat E10).
        // E10 får INTE bli "säsongsfinal" — listningen är inte komplett.
        seasons: [seasonMeta(4, 20)],
        next_episode_to_air: ep({ season_number: 4, episode_number: 10, air_date: '2026-05-31' }),
      }),
      season: { episodes: [ep({ season_number: 4, episode_number: 9, air_date: '2026-05-24' })] },
    }];
    const seeded = eps(buildCalendarEntries(data)).find(e => e.episode === 10);
    expect(seeded?.isFinale).toBe(false);
  });

  it('does not flag any finale when season episode_count is unavailable (prefer false)', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({
        seasons: [], // ingen episode_count-signal
        next_episode_to_air: ep({ season_number: 4, episode_number: 10, air_date: '2026-05-31' }),
      }),
      season: { episodes: [ep({ season_number: 4, episode_number: 9, air_date: '2026-05-24' })] },
    }];
    const seeded = eps(buildCalendarEntries(data)).find(e => e.episode === 10);
    expect(seeded?.isFinale).toBe(false);
  });

  it('falls back to free/ads providers when no flatrate exists (H3)', () => {
    // "Var streamas detta?" ska besvaras även för titlar som bara ligger på
    // en gratis-/reklamtjänst — annars blir metaraderna inkonsekventa mellan
    // kort (provider på vissa, saknas på andra fast TMDB vet svaret).
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({
        next_episode_to_air: null,
        'watch/providers': { results: { SE: { link: '', free: [{ provider_id: 89, provider_name: 'TV4 Play', logo_path: '' }] } } },
      }),
      season: { episodes: [ep({ episode_number: 1, air_date: '2026-05-26' })] },
    }];
    expect(buildCalendarEntries(data)[0].provider).toBeTruthy();
  });

  it('falls back to ads providers when neither flatrate nor free exists (H3)', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({
        next_episode_to_air: null,
        'watch/providers': { results: { SE: { link: '', ads: [{ provider_id: 76, provider_name: 'Viafree', logo_path: '' }] } } },
      }),
      season: { episodes: [ep({ episode_number: 1, air_date: '2026-05-26' })] },
    }];
    // id 76 är ett Viaplay-alias i SWEDISH_PROVIDERS — pipelinen kanonicaliserar
    // namnet (TMDB:s rå-namn "Viafree" → katalogens "Viaplay"). Ads-bucketen
    // används OCH namnet normaliseras.
    expect(buildCalendarEntries(data)[0].provider).toBe('Viaplay');
  });

  it('leaves provider undefined when only rent/buy is available', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({
        next_episode_to_air: null,
        'watch/providers': { results: { SE: { link: '', buy: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '' }] } } },
      }),
      season: { episodes: [ep({ episode_number: 1, air_date: '2026-05-26' })] },
    }];
    expect(buildCalendarEntries(data)[0].provider).toBeUndefined();
  });

  it('tags every episode entry with kind "episode" and mediaType "tv"', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: null }),
      season: { episodes: [ep({ episode_number: 1, air_date: '2026-05-26' })] },
    }];
    const entry = buildCalendarEntries(data)[0];
    expect(entry.kind).toBe('episode');
    expect(entry.mediaType).toBe('tv');
  });
});

function movie(partial: Partial<TMDBMovie>): TMDBMovie {
  return {
    id: 500, title: 'Test Movie', original_title: 'Test Movie', overview: 'En film.',
    poster_path: '/m.jpg', backdrop_path: '/mb.jpg', release_date: '2026-01-01',
    runtime: 120, vote_average: 0, vote_count: 0,
    genres: [{ id: 28, name: 'Action' }],
    'watch/providers': { results: { SE: { flatrate: [] } } },
    ...partial,
  } as TMDBMovie;
}

function seDigital(date: string) {
  return { results: [{ iso_3166_1: 'SE', release_dates: [{ type: 4, release_date: `${date}T00:00:00.000Z`, note: '' }] }] };
}

describe('buildMovieEntries', () => {
  const now = new Date('2026-06-08T12:00:00');

  it('includes a movie with a future SE digital release', () => {
    const entries = buildMovieEntries([movie({ release_dates: seDigital('2026-06-20') })], now);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'movie', mediaType: 'movie', releaseType: 'digital', airDate: '2026-06-20' });
  });

  it('skips movies whose SE digital release is in the past', () => {
    const entries = buildMovieEntries([movie({ release_dates: seDigital('2026-05-01') })], now);
    expect(entries).toHaveLength(0);
  });

  it('includes a movie releasing today (>= today)', () => {
    const entries = buildMovieEntries([movie({ release_dates: seDigital('2026-06-08') })], now);
    expect(entries).toHaveLength(1);
  });

  it('skips movies without an SE digital date', () => {
    const onlyTheatrical = { results: [{ iso_3166_1: 'SE', release_dates: [{ type: 3, release_date: '2026-07-01T00:00:00.000Z', note: '' }] }] };
    expect(buildMovieEntries([movie({ release_dates: onlyTheatrical })], now)).toHaveLength(0);
    expect(buildMovieEntries([movie({ release_dates: undefined })], now)).toHaveLength(0);
  });

  it('carries provider, overview, runtime and genres onto the entry', () => {
    const m = movie({
      release_dates: seDigital('2026-06-20'),
      'watch/providers': { results: { SE: { link: '', flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '' }] } } },
    });
    const entry = buildMovieEntries([m], now)[0];
    expect(entry.provider).toBeTruthy();
    expect(entry.kind === 'movie' && entry.overview).toBe('En film.');
    expect(entry.kind === 'movie' && entry.runtime).toBe(120);
    expect(entry.genreIds).toEqual([28]);
  });
});

describe('buildCalendarEntries — last_episode_to_air seed (PERF-1)', () => {
  it('seeds the last aired episode of a show whose season was not fetched', () => {
    const last = ep({ season_number: 3, episode_number: 8, air_date: '2024-03-01' });
    const out = eps(buildCalendarEntries([{ showId: 100, show: show({ last_episode_to_air: last }), season: null }]));
    expect(out.map(e => e.episodeCode)).toEqual(['S03E08']);
  });

  it('does not seed a special (season 0) as the last episode', () => {
    const last = ep({ season_number: 0, episode_number: 2, air_date: '2024-03-01' });
    const out = buildCalendarEntries([{ showId: 100, show: show({ last_episode_to_air: last }), season: null }]);
    expect(out).toEqual([]);
  });

  it('does not duplicate the last episode when the fetched season already lists it', () => {
    const last = ep({ season_number: 1, episode_number: 2, air_date: '2026-05-25' });
    const season = { episodes: [ep({ episode_number: 1, air_date: '2026-05-18' }), last] };
    const out = eps(buildCalendarEntries([{ showId: 100, show: show({ last_episode_to_air: last }), season }]));
    expect(out.map(e => e.episodeCode)).toEqual(['S01E01', 'S01E02']);
  });

  it('flags the seeded last episode as finale when it completes the season', () => {
    const last = ep({ season_number: 2, episode_number: 10, air_date: '2024-03-01' });
    const s = show({
      last_episode_to_air: last,
      seasons: [{ season_number: 2, episode_count: 10 }] as TMDBTVShow['seasons'],
    });
    const out = eps(buildCalendarEntries([{ showId: 100, show: s, season: null }]));
    expect(out[0].isFinale).toBe(true);
  });
});

describe('Fortsätt titta reads the last-episode seed (PERF-1)', () => {
  it('reports the seeded last episode as the latest aired position for an unfetched show', () => {
    const last = ep({ season_number: 3, episode_number: 8, air_date: '2024-03-01' });
    const entries = buildCalendarEntries([{ showId: 100, show: show({ last_episode_to_air: last }), season: null }]);
    expect(latestAiredEpisodeByShow(entries, new Date(2026, 9, 5)).get(100)).toEqual({ season: 3, episode: 8 });
  });
});

describe('finale badge stays in its own season (PERF-1)', () => {
  it('does not flag the previous season\'s last episode as the new season\'s finale', () => {
    const s = show({
      next_episode_to_air: ep({ season_number: 3, episode_number: 1, air_date: '2026-11-01' }),
      last_episode_to_air: ep({ season_number: 2, episode_number: 1, air_date: '2025-03-01' }),
      seasons: [{ season_number: 3, episode_count: 1 }] as TMDBTVShow['seasons'],
    });
    const out = eps(buildCalendarEntries([{ showId: 100, show: s, season: null }]));
    expect(out.find(e => e.season === 2)?.isFinale).toBe(false);
    expect(out.find(e => e.season === 3)?.isFinale).toBe(true);
  });
});
