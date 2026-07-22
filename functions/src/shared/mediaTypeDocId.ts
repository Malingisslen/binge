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

/**
 * Recover the numeric tmdbId from a per-title doc id, accepting BOTH the legacy
 * bare `123` shape and the namespaced `movie_123` / `tv_123` shape. Returns NaN
 * for anything unparseable (callers already guard with Number.isFinite).
 *
 * This exists because ~9 call sites fall back to `Number(docId)` when a doc's
 * `tmdbId` field is absent — and a bare `Number('tv_123')` is NaN, which would
 * silently drop the doc the moment the personal-library collections get
 * namespaced. Parsing off the prefix keeps that fallback working across the
 * mixed-format transition and after it.
 */
export function parseTmdbIdFromDocId(docId: string): number {
  const underscore = docId.indexOf('_');
  const numeric = underscore === -1 ? docId : docId.slice(underscore + 1);
  // Strict digits only: an empty suffix (`movie_`, `_`, ``) or junk (`movie_1_2`,
  // `tv_xyz`) must be NaN, NOT 0 — `Number('')` is 0, which would slip a phantom
  // title-id-0 doc past every downstream `Number.isFinite` guard.
  return /^[0-9]+$/.test(numeric) ? Number(numeric) : NaN;
}

/**
 * Recover the media type from a namespaced doc id. The STRICT inverse of the
 * prefix that `mediaTypeDocId` writes: only `movie_…`/`tv_…` resolve; a bare
 * legacy `123` (or anything else) returns `null` — it is genuinely
 * unattributable, and callers must decide whether to skip or default. This is
 * intentionally NOT `normalizeMediaType` (which defaults unknown → 'tv'): a doc
 * id either carries a recognised prefix or it doesn't. Mirror of the paired
 * mediaTypeDocId module — keep the two in sync.
 */
export function parseMediaTypeFromDocId(docId: string): MediaType | null {
  if (docId.startsWith('movie_')) return 'movie';
  if (docId.startsWith('tv_')) return 'tv';
  return null;
}

/**
 * The one canonical "recover the numeric tmdbId" resolver: prefer the doc's
 * stored `tmdbId` field, else parse it off the (possibly namespaced) doc id.
 * Replaces the field-or-parse idiom the read sites used to hand-roll. Returns
 * NaN when neither source yields a usable id (callers guard with
 * Number.isFinite). The field branch is guarded the SAME way parseTmdbIdFromDocId
 * guards its own — `Number('')`/`Number(null)` are 0, so an empty/absent/junk
 * field must fall through to the doc id, never slip past a finite check as a
 * phantom id-0. Mirror of the paired mediaTypeDocId module — keep the two in sync.
 */
export function resolveTmdbId(field: number | string | null | undefined, docId: string): number {
  const fromField = Number(field);
  return Number.isInteger(fromField) && fromField > 0 ? fromField : parseTmdbIdFromDocId(docId);
}
