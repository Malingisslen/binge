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

/* ------------------------------------------------------------------------- *
 * Orchestration decisions (BIN-452).
 *
 * The tmdbFieldsSweep loop lives in index.ts (firebase-admin), but the
 * DECISIONS it makes — the dry-run gate, when the cursor may resume, the
 * per-doc skip/clear verdict, the per-run budget ceilings, and the shape of
 * the audit record — are pure and safety-critical, so they live here, tested
 * under the admin-free root runner. index.ts is left as thin Firestore glue
 * (query → classify → batch) around these predicates.
 * ------------------------------------------------------------------------- */

/**
 * Per-run safety ceilings for the scan/write budget. Generous so a normal DB
 * finishes in one run; they only bite pathologically, at which point the cursor
 * resumes next invocation. Kept well under a day's free-tier quota (50k reads /
 * 20k writes) so a single run can never blow the 25 SEK/mo cap.
 */
export const MAX_DOCS_PER_RUN = 100_000;
export const MAX_CLEARS_PER_RUN = 18_000;

/**
 * Soft wall-clock deadline (< the 300s hard kill). The loop breaks here so the
 * `lastRun` audit record still writes on a slow month (DBA condition) — a
 * platform kill at 300s mid-loop would otherwise leave NO audit record, a
 * silent un-flagged failure rather than a `budgetAbort: true` one.
 */
export const SOFT_DEADLINE_MS = 270_000;

/**
 * Dry-run is the DEFAULT and ONLY an explicit boolean `true` enables writes.
 * Any other value — missing field, `undefined`, `'true'`, `1`, truthy object —
 * stays in dry-run. This is the whole-DB-blast-radius safety gate (the sweep
 * writes to every user's watchlist); it must never be satisfied by accident.
 */
export function resolveMutateEnabled(state: Record<string, unknown> | undefined | null): boolean {
  return state?.mutateEnabled === true;
}

/**
 * Resume the cross-run cursor ONLY in mutate mode. A dry-run always scans from
 * the start for a clean full count (and never persists a cursor of its own), so
 * a stale cursor left by a prior mutate run can't make a dry-run skip docs and
 * under-report `docsWouldClear`. Returns null (scan from doc 0) unless we're
 * mutating AND a string cursor is present.
 */
export function resolveStartCursor(
  state: Record<string, unknown> | undefined | null,
  mutateEnabled: boolean,
): string | null {
  const cursor = state?.cursor;
  return mutateEnabled && typeof cursor === 'string' ? cursor : null;
}

/** Per-doc verdict for the sweep loop. */
export type SweepDisposition = 'skip-fresh' | 'skip-empty' | 'clear';

/**
 * The idempotent per-doc decision, folding staleness + already-cleared into one
 * verdict:
 *  • `skip-fresh` — stamp within threshold → leave it (compliant).
 *  • `skip-empty` — stale/absent stamp but no clearable field present → skip the
 *    write (idempotency; saves a write against the cap on an already-swept doc).
 *  • `clear`      — stale AND still holds TMDB-derived data → clear it.
 * `data` is the doc's field map (already narrowed by `.select()` in index.ts).
 */
export function classifyWatchlistDoc(data: Record<string, unknown>, nowMs: number): SweepDisposition {
  const stampMs = tsToMillis(data[TMDB_FIELDS_STAMP]);
  if (!isTmdbFieldsStale(stampMs, nowMs)) return 'skip-fresh';
  if (allTargetFieldsAbsent(data)) return 'skip-empty';
  return 'clear';
}

/**
 * True once the per-run scan OR clear budget is spent — the loop breaks with
 * `budgetAbort: true` and resumes from the persisted cursor next invocation.
 * Boundary is inclusive (`>=`), matching the ceilings being hard caps.
 */
export function budgetExhausted(scanned: number, clearable: number): boolean {
  return scanned >= MAX_DOCS_PER_RUN || clearable >= MAX_CLEARS_PER_RUN;
}

/**
 * True once the elapsed wall-clock (nowMs − startMs) reaches the soft deadline,
 * so the loop breaks in time to still write the audit record before the 300s
 * hard kill. Inclusive boundary.
 */
export function deadlineReached(startMs: number, nowMs: number): boolean {
  return nowMs - startMs >= SOFT_DEADLINE_MS;
}

/**
 * The completed-full-pass cursor reset fires only in mutate mode (a dry-run
 * never owns a cursor). Resetting to null makes next month start fresh from
 * doc 0 instead of resuming a spent cursor.
 */
export function shouldResetCursor(mutateEnabled: boolean, fullPassCompleted: boolean): boolean {
  return mutateEnabled && fullPassCompleted;
}

/** Tallies the loop accumulates, fed into the audit record. */
export interface SweepRunTally {
  mutateEnabled: boolean;
  scanned: number;
  /** Docs that WOULD be (dry-run) / WERE (mutate) cleared. */
  clearable: number;
  skipped: number;
  budgetAbort: boolean;
  fullPassCompleted: boolean;
}

/**
 * Build the per-run audit record (`sweepState/tmdbFieldsSweep.lastRun`) — the
 * evidence the control ran against prod. The dry-run/mutate distinction is
 * encoded here so the record is honest: `docsCleared` is 0 in dry-run (nothing
 * was written) while `docsWouldClear` always reports what a mutate run WOULD
 * clear, so a dry-run's counts preview the real run. `serverTimestamp` is
 * injected (like buildClearedPayload's sentinel) to keep this admin-free.
 */
export function buildLastRunAudit(tally: SweepRunTally, serverTimestamp: unknown): Record<string, unknown> {
  return {
    at: serverTimestamp,
    dryRun: !tally.mutateEnabled,
    docsScanned: tally.scanned,
    docsCleared: tally.mutateEnabled ? tally.clearable : 0,
    docsWouldClear: tally.clearable,
    docsSkipped: tally.skipped,
    budgetAbort: tally.budgetAbort,
    fullPassCompleted: tally.fullPassCompleted,
  };
}
