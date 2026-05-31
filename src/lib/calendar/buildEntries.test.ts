import { describe, it, expect } from 'vitest';
import { buildCalendarEntries, type SeasonDatum } from './buildEntries';
import type { TMDBTVShow, TMDBEpisode } from '@/types';

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

describe('buildCalendarEntries', () => {
  it('seeds an entry from next_episode_to_air when the season array lacks it', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: ep({ season_number: 4, episode_number: 10, air_date: '2026-05-31', name: 'Finale' }) }),
      season: { episodes: [ep({ season_number: 4, episode_number: 9, air_date: '2026-05-24' })] },
    }];
    const entries = buildCalendarEntries(data);
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
    const entries = buildCalendarEntries(data);
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
});
