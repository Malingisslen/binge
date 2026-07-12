// BIN-185 follow-up — nearest-earlier recap fallback. When the user's exact boundary has
// no cached recap, we fall back to the closest EARLIER covered boundary — spoiler-safe by
// construction (an earlier recap covers a subset of what the user has watched; the tests
// lock that the fallback can never exceed the user's boundary). Which boundaries are
// covered comes from a per-show index doc `recaps/{tmdbId}_index` maintained by the upload
// script — a direct doc get, never a Firestore query (DBA condition: no .where() on recaps).

import { episodesUpToBoundary, type EpisodeRef, type SeasonEpisodes } from './boundary';

/** The per-show coverage index doc id. Cannot collide with recap ids (always int_int_int). */
export function recapIndexDocId(tmdbId: number): string {
  return `${tmdbId}_index`;
}

/**
 * Parse the index doc ({ boundaries: ["s_e", ...] }) into sorted EpisodeRefs.
 * Junk entries are dropped; a missing/invalid doc yields [] (→ no fallback, button hidden).
 */
export function parseRecapIndex(data: unknown): EpisodeRef[] {
  const raw = (data as { boundaries?: unknown } | null | undefined)?.boundaries;
  if (!Array.isArray(raw)) return [];
  const refs: EpisodeRef[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const m = /^(\d+)_(\d+)$/.exec(entry);
    if (!m) continue;
    const season = Number(m[1]);
    const episode = Number(m[2]);
    if (season < 1 || episode < 1) continue; // specials/junk — never a fallback target
    refs.push({ season, episode });
  }
  refs.sort((a, b) => a.season - b.season || a.episode - b.episode);
  return refs;
}

/**
 * The exact boundary if covered, else the nearest covered boundary STRICTLY BEFORE it,
 * else null. Never returns a boundary past `boundary` (the spoiler invariant).
 */
export function nearestCoveredBoundary(covered: EpisodeRef[], boundary: EpisodeRef): EpisodeRef | null {
  let best: EpisodeRef | null = null;
  for (const ref of covered) {
    const past = ref.season > boundary.season
      || (ref.season === boundary.season && ref.episode > boundary.episode);
    if (past) continue;
    if (!best || ref.season > best.season || (ref.season === best.season && ref.episode > best.episode)) {
      best = ref;
    }
  }
  return best;
}

/**
 * How many episodes (per the show inventory) lie strictly after `covered` up to and
 * including `user` — the "informationen från de senaste X avsnitten saknas" count.
 */
export function missingEpisodeCount(inventory: SeasonEpisodes, covered: EpisodeRef, user: EpisodeRef): number {
  return episodesUpToBoundary(inventory, user).length - episodesUpToBoundary(inventory, covered).length;
}
