// BIN-185 — the spoiler-boundary core. Pure, admin-free, so it unit-tests under the
// root runner and is shared by the /recap batch (which builds the ≤-boundary source set)
// and any consumer needing the cache key. THE product promise lives here: a recap for a
// boundary is built ONLY from episodes up to and including it — this function is the sole
// gate that decides which episodes are in scope, and the tests lock the invariant.

/** A show's episode inventory: for each season, its ordered episode numbers. */
export type SeasonEpisodes = { season: number; episodes: number[] }[];

export interface EpisodeRef {
  season: number;
  episode: number;
}

/** The cache doc id for a boundary — identical for every user at (tmdbId, season, episode). */
export function recapDocId(tmdbId: number, season: number, episode: number): string {
  return `${tmdbId}_${season}_${episode}`;
}

/** The cache doc id for a whole-season recap (`recaps/{tmdbId}_season_{season}`). Can never
 * collide with a boundary id (`season` is not a valid episode-position numeral). */
export function seasonRecapDocId(tmdbId: number, season: number): string {
  return `${tmdbId}_season_${season}`;
}

/**
 * Every COMPLETED season strictly before the boundary's season, in order — the exact set the
 * "Visa tidigare säsonger" disclosure may fetch season docs for. Deliberately derived from the
 * SAME `boundary.season` that gates `episodesUpToBoundary` (Security condition, BIN-185
 * story-so-far redesign): a season doc is only ever fetched for a season the user has fully
 * finished, never their current one (that's `textFull` instead) and never a future one.
 */
export function priorSeasonNumbers(boundary: EpisodeRef): number[] {
  const result: number[] = [];
  for (let s = 1; s < boundary.season; s++) result.push(s);
  return result;
}

/**
 * Every episode up to AND INCLUDING the boundary, in air order — the exact source set a
 * spoiler-safe recap may be built from. Guarantees (test-locked):
 *  • never a future season (`season > boundary.season`);
 *  • never a later episode within the boundary season (`episode > boundary.episode`);
 *  • never a special (`season < 1`) — specials have no clean linear position and are a
 *    spoiler risk, so they are excluded regardless of the inventory passed in.
 * Faithful to the inventory's actual episode numbers (handles gaps). Result is sorted by
 * (season, episode).
 */
export function episodesUpToBoundary(inventory: SeasonEpisodes, boundary: EpisodeRef): EpisodeRef[] {
  const result: EpisodeRef[] = [];
  for (const { season, episodes } of inventory) {
    if (season < 1) continue;              // exclude specials (season 0)
    if (season > boundary.season) continue; // exclude future seasons
    for (const episode of episodes) {
      // within the boundary season, drop anything past the boundary episode
      if (season === boundary.season && episode > boundary.episode) continue;
      result.push({ season, episode });
    }
  }
  result.sort((a, b) => a.season - b.season || a.episode - b.episode);
  // Dedupe by (season, episode) — TMDB payloads can list a season twice, which would
  // otherwise repeat episodes in the source set. Sorted, so dupes are adjacent.
  const seen = new Set<string>();
  return result.filter((r) => {
    const k = `${r.season}_${r.episode}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
