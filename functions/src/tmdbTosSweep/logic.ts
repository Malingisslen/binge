/**
 * Pure predicates + payload builder for the monthly TMDB ToS sweep (BIN-402) —
 * no firebase-admin imports so they unit-test under the root vitest toolchain
 * (same split as retentionCleanup/logic.ts and episodeNotify/logic.ts; the
 * functions-test-import gotcha: root `npm ci` in CI lacks firebase-admin, so
 * anything tested by the root runner MUST stay admin-free).
 *
 * Background: TMDB API terms §1.C forbid caching API-derived data > 6 months.
 * Binge denormalizes TMDB fields onto users/{uid}/watchlist/{tmdbId} with no
 * TTL. This sweep CLEARS (nulls) those fields once stale; freshness is restored
 * lazily on the next title-page view (which calls TMDB anyway) — never
 * proactively re-fetched (unbounded fan-out vs the 25 SEK/mo Blaze cap). See
 * ADR 0009 + docs/superpowers/plans/2026-07-03-bin-402-tmdb-tos-sweep.md.
 */

/**
 * Staleness trigger = 5 months (150 days), NOT 6. §1.C's 6-month figure is a
 * CEILING, not a target; a monthly cadence + budget throttling could otherwise
 * let a doc age past 6mo before it's caught. 5mo leaves a full month of slack.
 */
export const TMDB_FIELDS_MAX_AGE_MS = 5 * 30 * 24 * 60 * 60 * 1000;

/**
 * The HARD allowlist of denormalized TMDB-derived fields the sweep may clear.
 * This is the single source of truth for scope (DPO must-have): the update
 * payload's key-set is asserted set-equal to this + {tmdbFieldsRefreshedAt} in
 * logic.test.ts, so no user-authored field (rating/status/notes/lastWatched-*,
 * updatedAt/watchedAt/visibility/…) can ever ride along. Exactly the fields
 * enumerated in the plan — no silent carve-out (genreIds looks innocent but is
 * TMDB-derived). releaseYear/totalSeasons are intentionally out of the reviewed
 * scope and are NOT here.
 */
export const TMDB_DERIVED_FIELDS = [
  'title',
  'posterPath',
  'providers',
  'providersCheckedAt',
  'genreIds',
  'tmdbStatus',
  'runtime',
  'nextAirDate',
  'nextAirCode',
  'nextAirProvider',
  'nextAirUpdatedAt',
  'digitalReleaseDate',
] as const;

/**
 * The single doc-level freshness stamp the sweep sets on every touch. NOT a
 * clearable field — it records when the TMDB block was last known-compliant so
 * the next scan can skip fresh docs. Missing = stale (see isTmdbFieldsStale).
 */
export const TMDB_FIELDS_STAMP = 'tmdbFieldsRefreshedAt';

/**
 * User-authored / structural fields the sweep must NEVER touch. Not consumed by
 * production code — it exists so logic.test.ts can assert the clear payload
 * intersects none of them (a live tripwire if someone edits TMDB_DERIVED_FIELDS).
 */
export const FORBIDDEN_FIELDS = [
  'tmdbId',
  'mediaType',
  'status',
  'rating',
  'ratedAt',
  'notes',
  'releaseYear',
  'totalSeasons',
  'lastWatchedSeason',
  'lastWatchedEpisode',
  'dropped',
  'rewatchCount',
  'visibility',
  'tags',
  'addedAt',
  'updatedAt',
  'watchedAt',
] as const;

/**
 * Normalize a Firestore Timestamp field to epoch ms. Duck-typed on `toMillis()`
 * so this stays free of firebase-admin imports and is unit-testable; the Admin
 * SDK only ever returns a real Timestamp (with `toMillis`) for a timestamp
 * field. Anything else — missing field, number, string, undefined — yields null.
 */
export function tsToMillis(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const toMillis = (raw as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return null;
  const ms = (toMillis as () => unknown).call(raw);
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

/**
 * The TMDB-derived block is stale when its freshness stamp is older than the
 * threshold OR ABSENT. **Missing stamp = stale** is the safe default here — a
 * doc predating the stamp mechanism holds TMDB data of unknown, possibly >6mo
 * age that MUST be cleared for §1.C. (This flips retentionCleanup's stance,
 * where an undateable doc is KEPT: there the risk is deleting user data; here
 * the risk is RETAINING TMDB data, so the conservative default inverts.)
 */
export function isTmdbFieldsStale(stampMs: number | null, nowMs: number): boolean {
  return stampMs === null || stampMs < nowMs - TMDB_FIELDS_MAX_AGE_MS;
}

/**
 * True when none of the clearable TMDB fields is present on the doc — used to
 * skip the write entirely on an already-cleared doc (idempotency; saves writes
 * against the cap). A field counts as present when its value is not `undefined`
 * (Firestore returns undefined for an absent field; an explicit null counts as
 * present so a half-cleared legacy doc still gets a clean sweep).
 */
export function allTargetFieldsAbsent(data: Record<string, unknown>): boolean {
  return TMDB_DERIVED_FIELDS.every((f) => data[f] === undefined);
}

/**
 * Build the field-clearing update payload: every clearable field AND the freshness
 * stamp → the caller's `deleteSentinel` (FieldValue.delete()). INVARIANT (DPO
 * must-have, test-locked): the key set is EXACTLY TMDB_DERIVED_FIELDS ∪
 * {tmdbFieldsRefreshedAt} — never updatedAt, never any user-authored field. This is
 * a fresh object built only from the allowlist; it is NEVER a read-modify-write /
 * merge of the existing doc (that is the #1 way a mixed TMDB+user-authored doc gets
 * corrupted).
 *
 * BIN-402: the stamp is DELETED, not set fresh — a cleared doc must end up with an
 * ABSENT stamp so the title-page lazy-refresh (which fires on absent/stale) actually
 * repopulates it on next view. A fresh stamp would make needsTmdbFieldsRefresh return
 * false → the doc renders blank until the stamp aged out ~90 days. The next sweep
 * skips an already-cleared doc via allTargetFieldsAbsent (idempotent).
 */
export function buildClearedPayload(deleteSentinel: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of TMDB_DERIVED_FIELDS) payload[f] = deleteSentinel;
  payload[TMDB_FIELDS_STAMP] = deleteSentinel;
  return payload;
}
