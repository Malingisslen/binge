import { describe, it, expect } from 'vitest';
import {
  recapIndexDocId, parseRecapIndex, parseSeasonOnlySeasons, nearestCoveredBoundary, missingEpisodeCount,
} from './coverage';
import type { SeasonEpisodes } from './boundary';

describe('recapIndexDocId', () => {
  it('formats as tmdbId_index (cannot collide with int_int_int recap ids)', () => {
    expect(recapIndexDocId(1416)).toBe('1416_index');
  });
});

describe('parseRecapIndex', () => {
  it('parses a valid boundaries array into sorted EpisodeRefs', () => {
    const refs = parseRecapIndex({ boundaries: ['1_2', '1_1', '2_1'] });
    expect(refs).toEqual([
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
      { season: 2, episode: 1 },
    ]);
  });
  it('drops junk entries and returns [] for missing/invalid docs', () => {
    expect(parseRecapIndex({ boundaries: ['x_y', '1_1', '', 42] })).toEqual([{ season: 1, episode: 1 }]);
    expect(parseRecapIndex(null)).toEqual([]);
    expect(parseRecapIndex({})).toEqual([]);
    expect(parseRecapIndex({ boundaries: 'nope' })).toEqual([]);
  });
  it('drops season-0 / episode-0 entries (specials are never fallback targets)', () => {
    expect(parseRecapIndex({ boundaries: ['0_5', '1_0', '1_1'] })).toEqual([{ season: 1, episode: 1 }]);
  });
});

describe('parseSeasonOnlySeasons', () => {
  it('parses a valid seasonOnlySeasons array, sorted and deduped', () => {
    expect(parseSeasonOnlySeasons({ seasonOnlySeasons: [3, 1, 1, 2] })).toEqual([1, 2, 3]);
  });
  it('drops non-positive-integer junk and returns [] for missing/invalid docs', () => {
    expect(parseSeasonOnlySeasons({ seasonOnlySeasons: [1, 0, -1, 1.5, 'x', null, 2] })).toEqual([1, 2]);
    expect(parseSeasonOnlySeasons(null)).toEqual([]);
    expect(parseSeasonOnlySeasons({})).toEqual([]);
    expect(parseSeasonOnlySeasons({ seasonOnlySeasons: 'nope' })).toEqual([]);
  });
});

describe('nearestCoveredBoundary — the spoiler-safe fallback', () => {
  const covered = [
    { season: 1, episode: 1 }, { season: 1, episode: 2 },
    { season: 2, episode: 1 }, { season: 2, episode: 3 },
  ];

  it('returns the exact boundary when covered', () => {
    expect(nearestCoveredBoundary(covered, { season: 2, episode: 1 })).toEqual({ season: 2, episode: 1 });
  });

  it('falls back to the nearest EARLIER covered boundary on a gap', () => {
    // 2_2 not covered → nearest earlier is 2_1
    expect(nearestCoveredBoundary(covered, { season: 2, episode: 2 })).toEqual({ season: 2, episode: 1 });
  });

  it('falls back across a season boundary', () => {
    // user at 2_0-equivalent? use a show where season 3 has no coverage: user at 3_1 → 2_3
    expect(nearestCoveredBoundary(covered, { season: 3, episode: 1 })).toEqual({ season: 2, episode: 3 });
  });

  it('returns null when nothing at or before the boundary is covered', () => {
    expect(nearestCoveredBoundary(covered, { season: 0, episode: 5 })).toBeNull();
    expect(nearestCoveredBoundary([], { season: 5, episode: 5 })).toBeNull();
  });

  it('NEVER returns a boundary past the user boundary (spoiler invariant)', () => {
    for (const user of [
      { season: 1, episode: 1 }, { season: 1, episode: 3 },
      { season: 2, episode: 2 }, { season: 9, episode: 9 },
    ]) {
      const got = nearestCoveredBoundary(covered, user);
      if (got) {
        const exceeds = got.season > user.season || (got.season === user.season && got.episode > user.episode);
        expect(exceeds).toBe(false);
      }
    }
  });
});

describe('missingEpisodeCount — how many watched episodes the fallback recap misses', () => {
  const inv: SeasonEpisodes = [
    { season: 1, episodes: [1, 2, 3] },
    { season: 2, episodes: [1, 2, 3] },
  ];

  it('counts episodes strictly after the covered boundary up to the user boundary', () => {
    expect(missingEpisodeCount(inv, { season: 1, episode: 3 }, { season: 2, episode: 2 })).toBe(2); // 2_1, 2_2
    expect(missingEpisodeCount(inv, { season: 1, episode: 1 }, { season: 1, episode: 2 })).toBe(1);
  });

  it('returns 0 when covered == user (exact hit)', () => {
    expect(missingEpisodeCount(inv, { season: 2, episode: 2 }, { season: 2, episode: 2 })).toBe(0);
  });

  it('stays >= 0 and counts real aired episodes when the covered boundary exceeds the inventory (phantom index entry)', () => {
    // index claims 1_99 covered but season 1 only has 3 episodes: covered set == all of S1,
    // so a user at 2_1 is missing exactly the 1 real episode after it.
    expect(missingEpisodeCount(inv, { season: 1, episode: 99 }, { season: 2, episode: 1 })).toBe(1);
    expect(missingEpisodeCount(inv, { season: 1, episode: 99 }, { season: 2, episode: 1 })).toBeGreaterThanOrEqual(0);
  });

  it('never returns a negative count when covered <= user (the caller-guaranteed precondition)', () => {
    // nearestCoveredBoundary guarantees covered <= user; this pins the >= 0 contract there.
    expect(missingEpisodeCount(inv, { season: 1, episode: 1 }, { season: 2, episode: 3 })).toBeGreaterThanOrEqual(0);
  });
});

describe('parseRecapIndex — duplicates', () => {
  it('preserves duplicate entries (documented: consumers must tolerate dupes; nearestCoveredBoundary does)', () => {
    expect(parseRecapIndex({ boundaries: ['1_1', '1_1'] })).toEqual([
      { season: 1, episode: 1 },
      { season: 1, episode: 1 },
    ]);
  });
});
