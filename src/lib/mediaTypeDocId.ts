import type { MediaType } from '@/types/domain';

/**
 * Client mirror of `functions/src/shared/mediaTypeDocId.ts` (BIN-560).
 *
 * TMDB movie ids and TV ids are INDEPENDENT namespaces — movie N and TV N are
 * unrelated titles. Any per-title document keyed on tmdbId alone silently merges
 * the two. The server already namespaces its per-title collections this way; this
 * is the same rule for the client-owned personal-library collections
 * (watchlist / watchlistTags / watchlistNotes / episodeProgress / notInterested /
 * groups watchlist). Kept byte-identical in behaviour to the server helper so the
 * two can never disagree about where a title's doc lives.
 *
 * Legacy bare-`${tmdbId}` docs written before this migration are NOT addressed
 * here — each call site decides its own read-with-fallback policy next to the data.
 */

/**
 * Unknown/blank mediaType normalizes to 'tv', matching the server helper's
 * long-standing fallback. A call site that would rather skip an unknown media
 * type must guard before calling.
 */
export function normalizeMediaType(raw: string | null | undefined): MediaType {
  return raw === 'movie' ? 'movie' : 'tv';
}

/**
 * The canonical per-title doc id: `movie_${tmdbId}` / `tv_${tmdbId}`.
 * `tmdbId` accepts a string so Firestore path params (which arrive as strings)
 * pass straight through without a lossy Number() round-trip.
 */
export function mediaTypeDocId(mediaType: string | null | undefined, tmdbId: number | string): string {
  return `${normalizeMediaType(mediaType)}_${tmdbId}`;
}

/**
 * Recover the numeric tmdbId from a per-title doc id, accepting BOTH the legacy
 * bare `123` shape and the namespaced `movie_123` / `tv_123` shape. Returns NaN
 * for anything unparseable (callers guard with Number.isFinite). Mirror of the
 * server helper — keep in sync.
 */
export function parseTmdbIdFromDocId(docId: string): number {
  const underscore = docId.indexOf('_');
  const numeric = underscore === -1 ? docId : docId.slice(underscore + 1);
  // Strict digits only: an empty suffix (`movie_`, `_`, ``) or junk (`movie_1_2`,
  // `tv_xyz`) must be NaN, NOT 0 — `Number('')` is 0, which would slip a phantom
  // title-id-0 doc past every downstream `Number.isFinite` guard.
  return /^[0-9]+$/.test(numeric) ? Number(numeric) : NaN;
}
