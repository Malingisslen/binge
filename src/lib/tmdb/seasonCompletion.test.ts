import { describe, it, expect } from 'vitest';
import { seasonCompletion } from './seasonCompletion';

// A getWatchedCount that returns the season's full episode_count for the listed
// seasons (i.e. those seasons are fully watched), 0 otherwise.
function watchedFor(completeSeasons: number[]) {
  return (seasonNumber: number, episodeCount: number) =>
    completeSeasons.includes(seasonNumber) ? episodeCount : 0;
}

describe('seasonCompletion', () => {
  const seasons = [
    { season_number: 0, episode_count: 5 }, // specials — excluded
    { season_number: 1, episode_count: 8 },
    { season_number: 2, episode_count: 10 },
    { season_number: 3, episode_count: 6 },
  ];

  it('counts only real seasons (excludes specials) in the total', () => {
    const m = seasonCompletion(seasons, watchedFor([]));
    expect(m.total).toBe(3);
    expect(m.seen).toBe(0);
    expect(m.pct).toBe(0);
  });

  it('reports 100% when every real season is fully watched', () => {
    const m = seasonCompletion(seasons, watchedFor([1, 2, 3]));
    expect(m.seen).toBe(3);
    expect(m.total).toBe(3);
    expect(m.pct).toBe(100);
  });

  it('reports partial completion with rounded pct', () => {
    const m = seasonCompletion(seasons, watchedFor([1])); // 1 of 3
    expect(m.seen).toBe(1);
    expect(m.total).toBe(3);
    expect(m.pct).toBe(33);
  });

  it('does not count a season with only some episodes watched', () => {
    const partial = (seasonNumber: number, episodeCount: number) =>
      seasonNumber === 2 ? episodeCount - 1 : 0; // S2 one short
    const m = seasonCompletion(seasons, partial);
    expect(m.seen).toBe(0);
  });

  it('excludes placeholder seasons with no episodes (episode_count 0)', () => {
    const withUnaired = [...seasons, { season_number: 4, episode_count: 0 }];
    const m = seasonCompletion(withUnaired, watchedFor([1, 2, 3]));
    // S4 must not inflate the denominator
    expect(m.total).toBe(3);
    expect(m.pct).toBe(100);
  });

  it('returns a zeroed meter when there are no real seasons', () => {
    const m = seasonCompletion([{ season_number: 0, episode_count: 3 }], watchedFor([]));
    expect(m).toEqual({ seen: 0, total: 0, pct: 0 });
  });
});
