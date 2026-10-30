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

export interface NextToWatch {
  next: EpisodeRef;
  /** Episodes of `next`'s season the user has already seen (0 when `next` opens a new season). */
  watchedInSeason: number;
  seasonTotal: number;
}

/**
 * The episode right after the contiguous boundary, so it is the first one the user has NOT seen
 * — never one past a skipped gap. Null when the boundary is the last episode of the show: there
 * is nothing left to catch up for, and the caller shows no block.
 */
export function nextToWatch(inventory: SeasonEpisodes, boundary: EpisodeRef): NextToWatch | null {
  const ordered = [...inventory]
    .filter((s) => s.season >= 1)
    .sort((a, b) => a.season - b.season);
  const here = ordered.find((s) => s.season === boundary.season);
  const nextInSeason = here ? [...here.episodes].sort((a, b) => a - b).find((e) => e > boundary.episode) : undefined;
  if (here && nextInSeason !== undefined) {
    return {
      next: { season: here.season, episode: nextInSeason },
      watchedInSeason: here.episodes.filter((e) => e <= boundary.episode).length,
      seasonTotal: here.episodes.length,
    };
  }
  const following = ordered.find((s) => s.season > boundary.season && s.episodes.length > 0);
  if (!following) return null;
  return {
    next: { season: following.season, episode: Math.min(...following.episodes) },
    watchedInSeason: 0,
    seasonTotal: following.episodes.length,
  };
}

/**
 * The inventory limited to episodes that have aired, so "next to watch" and the season meter never
 * count an episode that does not exist yet. TMDB's episode_count includes announced episodes.
 * The cut-off is never earlier than what the user has already watched: TMDB's last_episode_to_air
 * can lag behind, and an episode the user has seen has by definition aired. A last-aired episode
 * in season 0 (a special) says nothing about the numbered order, so then the inventory is returned
 * as is.
 */
export function capInventoryToAired(
  inventory: SeasonEpisodes,
  lastAired: EpisodeRef | null | undefined,
  watchedThrough?: EpisodeRef | null,
): SeasonEpisodes {
  if (!lastAired || lastAired.season < 1) return inventory;
  const cut =
    watchedThrough && (watchedThrough.season > lastAired.season
      || (watchedThrough.season === lastAired.season && watchedThrough.episode > lastAired.episode))
      ? watchedThrough
      : lastAired;
  return inventory
    .filter((s) => s.season <= cut.season)
    .map((s) => (s.season === cut.season ? { ...s, episodes: s.episodes.filter((e) => e <= cut.episode) } : s));
}

/**
 * The inventory limited to what has aired, judged by air dates: the boundary season by its
 * per-episode dates, later seasons by their premiere date. TMDB's season and episode lists are
 * kept up to date by its editors while `last_episode_to_air` lags, so the dates are the better
 * source. An episode the user has watched always counts as aired. Without episode dates for the
 * boundary season (not loaded, or TMDB has none) the inventory is returned as is.
 */
export function capInventoryByAirDates(
  inventory: SeasonEpisodes,
  boundary: EpisodeRef,
  boundarySeasonDates: readonly { episode_number: number; air_date: string | null }[] | undefined,
  seasonPremieres: ReadonlyMap<number, string | null>,
  todayIso: string,
): SeasonEpisodes {
  if (!boundarySeasonDates || boundarySeasonDates.length === 0) return inventory;
  const airedEpisodes = new Set(
    boundarySeasonDates.filter((e) => !!e.air_date && e.air_date <= todayIso).map((e) => e.episode_number),
  );
  const out: SeasonEpisodes = [];
  for (const s of [...inventory].sort((a, b) => a.season - b.season)) {
    if (s.season < boundary.season) {
      out.push(s);
    } else if (s.season === boundary.season) {
      out.push({ ...s, episodes: s.episodes.filter((e) => e <= boundary.episode || airedEpisodes.has(e)) });
    } else {
      const premiere = seasonPremieres.get(s.season);
      if (!premiere || premiere > todayIso) break; // this season and every later one has not started
      out.push(s);
    }
  }
  return out;
}
