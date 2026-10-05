import { describe, it, expect } from 'vitest';
import { needsSeasonFetch, SEASON_LOOKBACK_DAYS } from './seasonFetch';
import type { TMDBTVShow, TMDBEpisode } from '@/types';

const NOW = new Date(2026, 9, 5, 12); // 2026-10-05 lokal tid

function ep(air_date: string, season_number = 2): TMDBEpisode {
  return { id: 1, episode_number: 3, season_number, name: 'Ep', overview: '', air_date, still_path: null, vote_average: 0, runtime: 40 };
}

function show(partial: Partial<TMDBTVShow>): TMDBTVShow {
  return { id: 1, name: 'S', number_of_seasons: 2, seasons: [], next_episode_to_air: null, last_episode_to_air: null, ...partial } as TMDBTVShow;
}

describe('needsSeasonFetch (PERF-1)', () => {
  it('fetches when a next episode is known', () => {
    expect(needsSeasonFetch(show({ next_episode_to_air: ep('2026-10-09') }), NOW)).toBe(true);
  });

  it('fetches when the last episode aired inside the lookback window, and the boundary day counts', () => {
    expect(SEASON_LOOKBACK_DAYS).toBe(60);
    expect(needsSeasonFetch(show({ last_episode_to_air: ep('2026-08-06') }), NOW)).toBe(true);
  });

  it('skips a show whose last episode aired before the window and has nothing scheduled', () => {
    expect(needsSeasonFetch(show({ last_episode_to_air: ep('2026-08-05') }), NOW)).toBe(false);
    expect(needsSeasonFetch(show({ last_episode_to_air: ep('2024-01-01') }), NOW)).toBe(false);
  });

  it('fetches an announced season that has a premiere date but no next_episode_to_air yet', () => {
    const s = show({
      last_episode_to_air: ep('2024-01-01'),
      seasons: [{ season_number: 3, air_date: '2026-11-20', episode_count: 8 }] as TMDBTVShow['seasons'],
    });
    expect(needsSeasonFetch(s, NOW)).toBe(true);
  });

  it('ignores specials (season 0) when looking for a recent season', () => {
    const s = show({
      last_episode_to_air: ep('2024-01-01'),
      seasons: [{ season_number: 0, air_date: '2026-10-01', episode_count: 1 }] as TMDBTVShow['seasons'],
    });
    expect(needsSeasonFetch(s, NOW)).toBe(false);
  });
});
