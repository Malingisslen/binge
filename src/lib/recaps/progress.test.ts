import { describe, it, expect } from 'vitest';
import { contiguousWatchedBoundary, inventoryFromSeasons } from './progress';
import type { SeasonEpisodes } from './boundary';

// A 3-season show: S1 has 3 eps, S2 has 3, S3 has 2. Specials (S0) present but irrelevant.
const inv: SeasonEpisodes = [
  { season: 1, episodes: [1, 2, 3] },
  { season: 2, episodes: [1, 2, 3] },
  { season: 3, episodes: [1, 2] },
];
const watchedSet = (keys: string[]) => (s: number, e: number) => keys.includes(`${s}_${e}`);

describe('inventoryFromSeasons', () => {
  it('builds episode lists from TMDB season episode counts, excluding specials', () => {
    const seasons = [
      { season_number: 0, episode_count: 5 }, // specials — excluded
      { season_number: 1, episode_count: 2 },
      { season_number: 2, episode_count: 0 }, // no episodes — excluded
    ];
    expect(inventoryFromSeasons(seasons)).toEqual([{ season: 1, episodes: [1, 2] }]);
  });
  it('returns [] for missing/invalid input', () => {
    expect(inventoryFromSeasons(undefined)).toEqual([]);
  });
});

describe('contiguousWatchedBoundary — the SPOILER-SAFE frontier (last unbroken episode)', () => {
  it('returns the last episode of an unbroken run from the start', () => {
    expect(contiguousWatchedBoundary(inv, watchedSet(['1_1', '1_2']))).toEqual({ season: 1, episode: 2 });
  });

  it('bridges a fully-watched season into the next', () => {
    expect(contiguousWatchedBoundary(inv, watchedSet(['1_1', '1_2', '1_3', '2_1']))).toEqual({ season: 2, episode: 1 });
  });

  it('STOPS at the first gap — out-of-order viewing never advances past a skipped episode (the spoiler fix)', () => {
    // watched S1E1-2 then jumped to S3E5-equivalent: boundary must stay at S1E2, NOT the max.
    expect(contiguousWatchedBoundary(inv, watchedSet(['1_1', '1_2', '3_2']))).toEqual({ season: 1, episode: 2 });
  });

  it('a mid-season gap caps the frontier before it even if later eps in the season are watched', () => {
    // S1E1, S1E2 watched, S1E3 skipped, S2E1 watched → frontier is S1E2 (S1E3 is an unwatched gap ≤ S2E1).
    expect(contiguousWatchedBoundary(inv, watchedSet(['1_1', '1_2', '2_1']))).toEqual({ season: 1, episode: 2 });
  });

  it('an incomplete lower season blocks bridging to a watched higher season', () => {
    // S1E1-2 watched, S1E3 NOT, S2 fully watched → frontier is S1E2 (S1E3 gap blocks everything after).
    expect(contiguousWatchedBoundary(inv, watchedSet(['1_1', '1_2', '2_1', '2_2', '2_3']))).toEqual({ season: 1, episode: 2 });
  });

  it('returns null when the very first episode is unwatched', () => {
    expect(contiguousWatchedBoundary(inv, watchedSet(['1_2', '1_3']))).toBeNull();
    expect(contiguousWatchedBoundary(inv, watchedSet([]))).toBeNull();
  });

  it('handles a full binge (everything watched) → last episode of the last season', () => {
    expect(contiguousWatchedBoundary(inv, () => true)).toEqual({ season: 3, episode: 2 });
  });

  it('is robust to unsorted inventory input', () => {
    const unsorted: SeasonEpisodes = [
      { season: 2, episodes: [2, 1, 3] },
      { season: 1, episodes: [3, 1, 2] },
    ];
    expect(contiguousWatchedBoundary(unsorted, watchedSet(['1_1', '1_2', '1_3', '2_1']))).toEqual({ season: 2, episode: 1 });
  });

  it('SEASON ordering: a higher season listed first must not become the frontier while a lower season lags (spoiler guard)', () => {
    // S2 listed first in the inventory; only S1 is watched. Without the season-level sort the
    // walk would hit S2 first and return null (or a higher season) — this pins the sort.
    const seasonFirst: SeasonEpisodes = [
      { season: 2, episodes: [1, 2] },
      { season: 1, episodes: [1, 2] },
    ];
    expect(contiguousWatchedBoundary(seasonFirst, watchedSet(['1_1', '1_2']))).toEqual({ season: 1, episode: 2 });
  });
});
