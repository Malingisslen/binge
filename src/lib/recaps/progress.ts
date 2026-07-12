// BIN-185 — derive the user's SPOILER-SAFE recap boundary. Pure/admin-free (root-testable).
// The boundary is the ONLY per-user input and never reaches any AI.
//
// CRITICAL (code-review 2026-07-12): the boundary must be the CONTIGUOUS frontier — the last
// episode of the user's unbroken run from the very start — NOT the numerically highest watched
// episode. Out-of-order viewing (watch S1E1-2, then jump ahead to S3E5) must NOT advance the
// boundary past the gap, or a recap-to-that-boundary would summarise episodes the user skipped
// and hasn't seen — a spoiler in a spoiler-safe feature. Detecting a gap needs the show's episode
// inventory (which episodes EXIST), so this takes the inventory + an isWatched predicate.

import type { EpisodeRef, SeasonEpisodes } from './boundary';

/** A TMDB show season as it appears on the detail payload (only the fields we need). */
export interface TmdbSeasonLite {
  season_number: number;
  episode_count: number;
}

/**
 * Build a SeasonEpisodes inventory from a TMDB show's `seasons`, using each season's
 * episode_count to enumerate 1..count. Specials (season 0) and empty/invalid seasons excluded.
 */
export function inventoryFromSeasons(seasons: TmdbSeasonLite[] | undefined | null): SeasonEpisodes {
  if (!Array.isArray(seasons)) return [];
  return seasons
    .filter(
      (s) =>
        Number.isInteger(s?.season_number) && s.season_number >= 1 &&
        Number.isInteger(s?.episode_count) && s.episode_count > 0,
    )
    .map((s) => ({ season: s.season_number, episodes: Array.from({ length: s.episode_count }, (_, i) => i + 1) }));
}

/**
 * The spoiler-safe boundary = the last episode of the user's UNBROKEN contiguous run from the
 * start. Walks the inventory in air order (season asc, episode asc) and STOPS at the first
 * episode the user has not watched. Returns null if the very first episode is unwatched.
 * Everything ≤ the returned boundary is guaranteed watched, so a recap built to it can never
 * cover a skipped episode.
 */
export function contiguousWatchedBoundary(
  inventory: SeasonEpisodes,
  isWatched: (season: number, episode: number) => boolean,
): EpisodeRef | null {
  const ordered = [...inventory]
    .filter((s) => s.season >= 1)
    .sort((a, b) => a.season - b.season);
  let frontier: EpisodeRef | null = null;
  for (const { season, episodes } of ordered) {
    for (const episode of [...episodes].sort((a, b) => a - b)) {
      if (!isWatched(season, episode)) return frontier; // first gap → stop
      frontier = { season, episode };
    }
  }
  return frontier;
}
