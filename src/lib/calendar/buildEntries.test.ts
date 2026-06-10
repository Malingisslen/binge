import { describe, it, expect } from 'vitest';
import { buildCalendarEntries, buildMovieEntries, type SeasonDatum } from './buildEntries';
import type { TMDBTVShow, TMDBEpisode, TMDBMovie } from '@/types';
import type { EpisodeEntry, MovieEntry } from './types';

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

  it('marks the seeded finale episode isFinale even when the season array lags', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: ep({ season_number: 4, episode_number: 10, air_date: '2026-05-31' }) }),
      season: { episodes: [ep({ season_number: 4, episode_number: 9, air_date: '2026-05-24' })] },
    }];
    const seeded = eps(buildCalendarEntries(data)).find(e => e.episode === 10);
    expect(seeded?.isFinale).toBe(true);
  });

  it('defaults source to "mina" and stamps "vill_se" when asked', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: null }),
      season: { episodes: [ep({ episode_number: 1, air_date: '2026-05-26' })] },
    }];
    expect(buildCalendarEntries(data)[0].source).toBe('mina');
    expect(buildCalendarEntries(data, 'vill_se')[0].source).toBe('vill_se');
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
    expect(entries[0]).toMatchObject({ kind: 'movie', mediaType: 'movie', source: 'vill_se', releaseType: 'digital', airDate: '2026-06-20' });
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
