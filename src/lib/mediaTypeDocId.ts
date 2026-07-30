import type { MediaType } from '@/types/domain';

/**
 * Client mirror of `functions/src/shared/mediaTypeDocId.ts` (BIN-560).
 *
 * TMDB movie ids and TV ids are INDEPENDENT namespaces — movie N and TV N are
 * unrelated titles. Any per-title document keyed on tmdbId alone silently merges
 * the two. The server already namespaces its per-title collections this way; this
 * is the same rule for the client-owned personal-library collections
 * (watchlist / watchlistTags / watchlistNotes / episodeProgress / notInterested /
 * groups watchlist). The WRITE side is byte-identical in behaviour to the server
 * helper, so the two can never disagree about where a title's doc lives.
 *
 * The READ side is NOT identical any more: `parseTmdbIdFromDocId` below accepts
 * only canonical ids, while the server copy stays permissive (BIN-618 — see that
 * function's own note for why the divergence is deliberate and which direction is
 * safe). Do not "resync" the pair on the strength of this header.
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
 * The numeric part of a doc id in CANONICAL form — exactly what `mediaTypeDocId`
 * emits for a number, i.e. no leading zeros. `042` is an ALIAS: it parses to the
 * same 42 the genuine key means, so a hand-written `movie_042` doc would be
 * re-keyed onto the real `movie_42` slot and could mask its contents. Anything a
 * canonical writer could never produce is treated as unparseable instead. (BIN-618)
 */
const CANONICAL_TMDB_ID = /^(?:0|[1-9][0-9]*)$/;

/**
 * Recover the numeric tmdbId from a per-title doc id, accepting BOTH the legacy
 * bare `123` shape and the namespaced `movie_123` / `tv_123` shape. Returns NaN
 * for anything unparseable (callers guard with Number.isFinite).
 *
 * It is the STRICT inverse of `mediaTypeDocId`: only a bare canonical number or
 * a `movie_`/`tv_` prefix resolves. An unknown prefix (`zmovie_42`, `season_5`)
 * used to yield the number after the underscore, which made it an alias of the
 * LEGACY bare id — the same collision as `movie_042` is on the namespaced side.
 *
 * DELIBERATE DIVERGENCE from `functions/src/shared/mediaTypeDocId.ts`: only this
 * client copy rejects non-canonical ids. BIN-618 scoped the alias-collision fix
 * to the client read path, where the Tillsammans swipe docs are re-keyed by
 * `candidateKey`. Everything else in the pair stays in sync — do not "resync"
 * this function without moving the server copy too.
 */
export function parseTmdbIdFromDocId(docId: string): number {
  const underscore = docId.indexOf('_');
  if (underscore !== -1) {
    const prefix = docId.slice(0, underscore);
    if (prefix !== 'movie' && prefix !== 'tv') return NaN;
  }
  const numeric = underscore === -1 ? docId : docId.slice(underscore + 1);
  // Strict canonical digits only: an empty suffix (`movie_`, `_`, ``), junk
  // (`movie_1_2`, `tv_xyz`) or an alias (`movie_042`) must be NaN, NOT 0 —
  // `Number('')` is 0, which would slip a phantom title-id-0 doc past every
  // downstream `Number.isFinite` guard.
  return CANONICAL_TMDB_ID.test(numeric) ? Number(numeric) : NaN;
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
 * Number.isFinite). The field branch rejects the same EMPTY/junk cases the doc-id
 * branch does — `Number('')`/`Number(null)` are 0, so an empty/absent/junk field
 * must fall through to the doc id, never slip past a finite check as a phantom
 * id-0 — but it is NOT canonical-strict the way BIN-618 made the doc-id branch:
 * `Number('042')` is 42, so a doc keyed `movie_042` that ALSO stores
 * `tmdbId: '042'` still resolves to 42, while the same doc without the field is
 * NaN. Tightening the field branch is tracked in BIN-646; do not read the two
 * branches as equivalent in the meantime. Paired with the server module — but NOT identical any more: the
 * doc-id branch delegates to `parseTmdbIdFromDocId` above, which since BIN-618
 * accepts only canonical ids on the client. So this function diverges too, for
 * field-less legacy docs: `resolveTmdbId(null, 'movie_042')` is NaN here and 42
 * on the server. Deliberate — see that function's note before "resyncing".
 */
export function resolveTmdbId(field: number | string | null | undefined, docId: string): number {
  const fromField = Number(field);
  return Number.isInteger(fromField) && fromField > 0 ? fromField : parseTmdbIdFromDocId(docId);
}
