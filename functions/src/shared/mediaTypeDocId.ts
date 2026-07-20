/**
 * Shared media-type doc-id namespacing (BIN-560).
 *
 * TMDB movie ids and TV ids are INDEPENDENT namespaces — movie N and TV N are
 * unrelated titles. Any per-title document keyed on tmdbId alone silently
 * merges the two, which is the bug class BIN-523 / BIN-529 / BIN-545 were all
 * filed against. Three modules had each reinvented this template literal; this
 * is the single place it lives now.
 *
 * What this module deliberately does NOT decide: how a call site treats the
 * LEGACY bare-`${tmdbId}` documents written before namespacing. That answer
 * differs per collection (read-with-fallback, orphan, or skip) and belongs at
 * the call site, next to the data — restating it here just drifts.
 */

export type MediaType = 'movie' | 'tv';

/**
 * Unknown/blank mediaType normalizes to 'tv', matching the long-standing
 * fetch/actionUrl fallback in availableNotify. A call site that would rather
 * SKIP an unknown media type (communityRatings does) must guard before calling.
 */
export function normalizeMediaType(raw: string | null | undefined): MediaType {
  return raw === 'movie' ? 'movie' : 'tv';
}

/**
 * The canonical per-title doc id: `movie_${tmdbId}` / `tv_${tmdbId}`.
 * `tmdbId` accepts a string so Firestore path params (which arrive as strings)
 * can be passed straight through without a lossy Number() round-trip.
 */
export function mediaTypeDocId(mediaType: string | null | undefined, tmdbId: number | string): string {
  return `${normalizeMediaType(mediaType)}_${tmdbId}`;
}
