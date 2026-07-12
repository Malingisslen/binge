import { describe, it, expect } from 'vitest';
import { episodesUpToBoundary, recapDocId, type SeasonEpisodes } from './boundary';

// A small 3-season show with a gap (S2 skips ep 3) and a specials season 0.
const inventory: SeasonEpisodes = [
  { season: 0, episodes: [1, 2] }, // specials — must never be included
  { season: 1, episodes: [1, 2, 3] },
  { season: 2, episodes: [1, 2, 4] }, // note the gap (no ep 3)
  { season: 3, episodes: [1, 2] },
];

const key = (r: { season: number; episode: number }) => `S${r.season}E${r.episode}`;

describe('recapDocId', () => {
  it('formats as tmdbId_season_episode', () => {
    expect(recapDocId(1399, 2, 3)).toBe('1399_2_3');
  });
});

describe('episodesUpToBoundary — the spoiler-boundary invariant', () => {
  it('S1E1 boundary yields only S1E1', () => {
    expect(episodesUpToBoundary(inventory, { season: 1, episode: 1 }).map(key)).toEqual(['S1E1']);
  });

  it('mid-season boundary yields all prior episodes + up to the boundary in that season', () => {
    expect(episodesUpToBoundary(inventory, { season: 2, episode: 2 }).map(key)).toEqual([
      'S1E1', 'S1E2', 'S1E3', 'S2E1', 'S2E2',
    ]);
  });

  it('a season-rollover boundary (S2E1) includes all of season 1 + S2E1', () => {
    expect(episodesUpToBoundary(inventory, { season: 2, episode: 1 }).map(key)).toEqual([
      'S1E1', 'S1E2', 'S1E3', 'S2E1',
    ]);
  });

  it('respects gaps in episode numbering (S2 has no ep 3)', () => {
    expect(episodesUpToBoundary(inventory, { season: 2, episode: 4 }).map(key)).toEqual([
      'S1E1', 'S1E2', 'S1E3', 'S2E1', 'S2E2', 'S2E4',
    ]);
  });

  it('NEVER includes an episode past the boundary — no future season, no later episode in the boundary season', () => {
    const out = episodesUpToBoundary(inventory, { season: 2, episode: 2 });
    expect(out.some(r => r.season > 2)).toBe(false);          // no future season
    expect(out.some(r => r.season === 2 && r.episode > 2)).toBe(false); // nothing later in S2
  });

  it('NEVER includes specials (season 0) — no clean linear boundary, spoiler risk', () => {
    const out = episodesUpToBoundary(inventory, { season: 3, episode: 2 });
    expect(out.some(r => r.season === 0)).toBe(false);
  });

  it('dedupes a season listed twice in the inventory (TMDB payloads can duplicate)', () => {
    const dup: SeasonEpisodes = [
      { season: 1, episodes: [1, 2] },
      { season: 1, episodes: [1, 2] }, // same season again
    ];
    expect(episodesUpToBoundary(dup, { season: 1, episode: 2 }).map(key)).toEqual(['S1E1', 'S1E2']);
  });

  it('a boundary beyond available episodes returns all available ≤ boundary (no crash)', () => {
    expect(episodesUpToBoundary(inventory, { season: 2, episode: 99 }).map(key)).toEqual([
      'S1E1', 'S1E2', 'S1E3', 'S2E1', 'S2E2', 'S2E4',
    ]);
  });

  it('invariant holds for every boundary in the inventory: no returned ref exceeds the boundary tuple', () => {
    for (const { season, episodes } of inventory) {
      if (season < 1) continue;
      for (const episode of episodes) {
        const out = episodesUpToBoundary(inventory, { season, episode });
        for (const r of out) {
          const exceeds = r.season > season || (r.season === season && r.episode > episode);
          expect(exceeds).toBe(false);
          expect(r.season).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});
