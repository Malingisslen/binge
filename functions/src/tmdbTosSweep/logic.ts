/**
 * Pure predicates + payload builder for the monthly TMDB ToS sweep (BIN-402 /
 * BIN-468) — no firebase-admin imports so they unit-test under the root vitest
 * toolchain (same split as retentionCleanup/logic.ts and episodeNotify/logic.ts;
 * the functions-test-import gotcha: root `npm ci` in CI lacks firebase-admin, so
 * anything tested by the root runner MUST stay admin-free).
 *
 * Background: TMDB API terms §1.C forbid caching API-derived data > 6 months.
 * Binge denormalizes TMDB fields onto users/{uid}/watchlist/{tmdbId} with no
 * TTL. This sweep CLEARS (nulls) those fields once stale; freshness is restored
 * lazily by each field-group's own repair path — never proactively re-fetched
 * (unbounded fan-out vs the 25 SEK/mo Blaze cap). See ADR 0009 +
 * ~/.claude/plans/binge-bin468-stage2.md.
 *
 * BIN-468 — PER-GROUP FRESHNESS. A single doc-level stamp is NOT enough: the
 * title page re-writes only a subset of the TMDB block while renewing one stamp,
 * so a user who only ever opens title pages keeps that stamp perpetually fresh
 * while providers / next-air data silently age past 6 months. The fix: three
 * independently-gated field GROUPS, each checked against its OWN stamp and its
 * OWN repair path (title-page lazy-refresh / advisor+backfill / calendar
 * read-repair). Each group is cleared independently when ITS stamp is stale, and
 * the clear deletes only that group's stamp so its own repair path repopulates
 * it — never clobbering a sibling group that is still fresh.
 */

/**
 * Staleness trigger = 5 months (150 days), NOT 6. §1.C's 6-month figure is a
 * CEILING, not a target; a monthly cadence + budget throttling could otherwise
 * let a doc age past 6mo before it's caught. 5mo leaves a full month of slack.
 */
export const TMDB_FIELDS_MAX_AGE_MS = 5 * 30 * 24 * 60 * 60 * 1000;

/**
 * A field group: a set of denormalized TMDB-derived data `fields` that share one
 * `stamp` (freshness gate + repair marker) and one repair path. The sweep judges
 * staleness per group against `stamp`, and on clear deletes the group's `fields`
 * AND its `stamp` together (never a sibling group's).
 */
export interface FieldGroup {
  readonly name: 'static' | 'providers' | 'nextair';
  readonly fields: readonly string[];
  readonly stamp: string;
}

/**
 * Static block — the fields the title-page lazy-refresh (addItem +
 * refreshTmdbFields) owns. Gated by `tmdbFieldsRefreshedAt`.
 */
export const STATIC_GROUP: FieldGroup = {
  name: 'static',
  fields: ['title', 'posterPath', 'genreIds', 'tmdbStatus', 'runtime'],
  stamp: 'tmdbFieldsRefreshedAt',
};

/**
 * Providers — gated by `providersCheckedAt`. Repaired by the advisor/backfill
 * path and, as a conditional fallback, the title page (BIN-468 A2: the title
 * page only writes providers when providersCheckedAt is not already fresher than
 * the advisor's re-check window, and co-stamps providersCheckedAt when it does).
 */
export const PROVIDERS_GROUP: FieldGroup = {
  name: 'providers',
  fields: ['providers'],
  stamp: 'providersCheckedAt',
};

/**
 * Next-air trio + the movie digital-release date — gated by `nextAirUpdatedAt`,
 * repaired only by the Calendar read-repair (nextAirReadRepair). Grouped
 * together because that one writer computes both in the same pass.
 */
export const NEXTAIR_GROUP: FieldGroup = {
  name: 'nextair',
  fields: ['nextAirDate', 'nextAirCode', 'nextAirProvider', 'digitalReleaseDate'],
  stamp: 'nextAirUpdatedAt',
};

/** The three groups, in a stable order (used for iteration + audit keys). */
export const FIELD_GROUPS: readonly FieldGroup[] = [STATIC_GROUP, PROVIDERS_GROUP, NEXTAIR_GROUP];

/**
 * Every key the sweep may ever delete: each group's data fields ∪ each group's
 * stamp. This is the total clearing scope (DPO must-have) — the per-group clear
 * payloads are asserted set-equal to `fields ∪ {stamp}` in logic.test.ts, so no
 * user-authored field can ever ride along.
 */
export const ALL_CLEARABLE_KEYS: readonly string[] = [
  ...FIELD_GROUPS.flatMap((g) => g.fields),
  ...FIELD_GROUPS.map((g) => g.stamp),
];

/**
 * Everything the scan loop must `.select()` to judge each group: every stamp (to
 * read freshness) + every data field (to test presence). Same key set as
 * ALL_CLEARABLE_KEYS, named separately for intent at the query site.
 */
export const ALL_SELECT_KEYS: readonly string[] = ALL_CLEARABLE_KEYS;

/**
 * User-authored / structural fields the sweep must NEVER touch. Not consumed by
 * production code — it exists so logic.test.ts can assert the clear payload
 * intersects none of them (a live tripwire if someone edits a group's fields).
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
 * A TMDB stamp is stale when older than the threshold OR ABSENT. **Missing stamp
 * = stale** is the safe default here — a doc predating the stamp holds TMDB data
 * of unknown, possibly >6mo age that MUST be cleared for §1.C. (This flips
 * retentionCleanup's stance, where an undateable doc is KEPT: there the risk is
 * deleting user data; here the risk is RETAINING TMDB data, so it inverts.)
 */
export function isTmdbFieldsStale(stampMs: number | null, nowMs: number): boolean {
  return stampMs === null || stampMs < nowMs - TMDB_FIELDS_MAX_AGE_MS;
}

/** True when a group's own stamp is stale/absent (the group may need clearing). */
export function groupIsStale(group: FieldGroup, data: Record<string, unknown>, nowMs: number): boolean {
  return isTmdbFieldsStale(tsToMillis(data[group.stamp]), nowMs);
}

/**
 * True when at least one of a group's DATA fields is present on the doc — used to
 * skip clearing a group that holds nothing (idempotency; saves writes against the
 * cap). A field counts as present when not `undefined` (Firestore returns
 * undefined for an absent field; an explicit null counts as present so a
 * half-cleared legacy doc still gets a clean sweep). The group's stamp is NOT a
 * data field and never counts here.
 */
export function groupHasData(group: FieldGroup, data: Record<string, unknown>): boolean {
  return group.fields.some((f) => data[f] !== undefined);
}

/**
 * The groups this doc needs swept: each group that is stale AND still holds data.
 * A fresh group is left untouched; a stale-but-empty group is skipped (already
 * clear). Order follows FIELD_GROUPS.
 */
export function groupsToClear(data: Record<string, unknown>, nowMs: number): FieldGroup[] {
  return FIELD_GROUPS.filter((g) => groupIsStale(g, data, nowMs) && groupHasData(g, data));
}

/**
 * Build the field-clearing update payload for the given groups: each group's data
 * fields AND its own stamp → the caller's `deleteSentinel` (FieldValue.delete()).
 * INVARIANT (DPO must-have, test-locked): the key set is EXACTLY the union of the
 * passed groups' (fields ∪ {stamp}) — never updatedAt, never a user-authored
 * field, never a stamp of a group that isn't being cleared. A fresh object built
 * only from the allowlist; NEVER a read-modify-write / merge of the existing doc.
 *
 * Each cleared group's stamp is DELETED, not set fresh — a cleared group must end
 * absent-stamped so its own repair path (which fires on absent/stale) repopulates
 * it. The next sweep skips an already-cleared group via groupHasData (idempotent).
 * A SINGLE flat payload spanning all stale groups → a single per-doc write.
 */
export function buildClearedPayload(groups: readonly FieldGroup[], deleteSentinel: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const g of groups) {
    for (const f of g.fields) payload[f] = deleteSentinel;
    payload[g.stamp] = deleteSentinel;
  }
  return payload;
}

/**
 * BIN-504 — collection-group SCOPE guard. `collectionGroup('watchlist')` matches
 * EVERY `watchlist` subcollection in the database, which is TWO distinct things:
 * `users/{uid}/watchlist/{tmdbId}` (the user-owned TMDB denormalizations this
 * sweep exists to clear) AND `groups/{id}/watchlist/{tmdbId}` (group-owned docs
 * that also carry title/posterPath). The sweep must touch ONLY the former — a
 * group watchlist doc judged "stale" and cleared would wipe a live group's
 * titles. Firestore can't scope a collection-group query by parent, so we filter
 * post-read on the doc PATH: a user watchlist doc is exactly
 * `users/{uid}/watchlist/{tmdbId}` — 4 segments, grandparent collection `users`.
 * Anything else (grandparent `groups`, or any future `watchlist` nesting) is
 * skipped and NEVER cleared.
 */
export function isUserWatchlistDocPath(path: string): boolean {
  const segments = path.split('/');
  return segments.length === 4 && segments[0] === 'users' && segments[2] === 'watchlist';
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
 * resumes next invocation. Each ceiling is held at/under Firestore's per-DAY
 * free-tier quota (50k reads / 20k writes) so a single run can never blow the
 * 25 SEK/mo cap: the scan ceiling caps reads at the 50k read quota, the clear
 * ceiling (18k) sits under the 20k write quota. (BIN-507: the scan ceiling was
 * 100_000 — double the read quota it is documented to stay within — so a large
 * run could bill reads past the free tier; realigned to 50_000.)
 */
export const MAX_DOCS_PER_RUN = 50_000;
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
 * The state-doc field that persists the cross-run cursor for the current mode.
 * Mutate and dry-run keep SEPARATE cursors (`cursor` vs `dryRunCursor`, BIN-507)
 * so the two modes never resume each other's position: a stale mutate cursor
 * can't make a dry-run skip docs, and — the reason dry-run gets its own — a
 * dry-run that budget-aborts persists `dryRunCursor` and resumes past the wall
 * next run instead of restarting at doc 0 and re-hitting the identical ceiling,
 * which would leave the tail of the DB perpetually un-counted (`docsWouldClear`
 * under-reports the true clearable total).
 */
export function cursorFieldFor(mutateEnabled: boolean): 'cursor' | 'dryRunCursor' {
  return mutateEnabled ? 'cursor' : 'dryRunCursor';
}

/**
 * Resume the cross-run cursor for the current mode — mutate reads `cursor`,
 * dry-run reads its own `dryRunCursor` (BIN-507). Returns null (scan from doc 0)
 * unless the mode's cursor is a stored string. A dry-run therefore ignores the
 * mutate cursor entirely (and vice-versa), so neither mode can be nudged off its
 * own start position by the other's leftover cursor.
 */
export function resolveStartCursor(
  state: Record<string, unknown> | undefined | null,
  mutateEnabled: boolean,
): string | null {
  const cursor = state?.[cursorFieldFor(mutateEnabled)];
  return typeof cursor === 'string' ? cursor : null;
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
 * A completed full pass resets the current mode's cursor (BIN-507: both modes now
 * own a cursor — see cursorFieldFor). Resetting to null makes the NEXT run of that
 * mode start fresh from doc 0 for a clean full count instead of resuming a spent
 * cursor; an incomplete pass (budget/deadline abort) leaves the cursor so the next
 * run resumes past the wall. The caller resets the mode-appropriate field.
 */
export function shouldResetCursor(fullPassCompleted: boolean): boolean {
  return fullPassCompleted;
}

/** Per-group tally of docs that would be / were cleared (BIN-468 A6 audit). */
export interface GroupClearTally {
  static: number;
  providers: number;
  nextair: number;
}

/** Tallies the loop accumulates, fed into the audit record. */
export interface SweepRunTally {
  mutateEnabled: boolean;
  scanned: number;
  /** Docs that WOULD be (dry-run) / WERE (mutate) cleared (any group). */
  clearable: number;
  skipped: number;
  budgetAbort: boolean;
  fullPassCompleted: boolean;
  /** How many docs had each group cleared — the per-group would-clear breakdown. */
  wouldClearByGroup: GroupClearTally;
}

/**
 * Build the per-run audit record (`sweepState/tmdbFieldsSweep.lastRun`) — the
 * evidence the control ran against prod. The dry-run/mutate distinction is
 * encoded here so the record is honest: `docsCleared` is 0 in dry-run (nothing
 * was written) while `docsWouldClear` (+ the per-group breakdown) always reports
 * what a mutate run WOULD clear, so a dry-run's counts preview the real run.
 *
 * The per-group breakdown is BIN-468's enable-gate metric (A6): the nextair group
 * propagates only via Calendar visits so it structurally clears at a higher rate
 * than static/providers — a blended `docsWouldClear` would hide that, so the flip
 * decision reads the groups separately. `serverTimestamp` is injected (like
 * buildClearedPayload's sentinel) to keep this admin-free.
 *
 * BIN-507: when the run THREW, pass the caught `error` so the audit record itself
 * flags the failure (`error: true` + `errorMessage`) with whatever counts were
 * accumulated before the throw — a thrown run must still leave a `lastRun` record,
 * never a silent gap that reads as "the sweep didn't run this month". Omitted /
 * null `error` → no error fields (a clean run's shape is unchanged).
 */
export function buildLastRunAudit(
  tally: SweepRunTally,
  serverTimestamp: unknown,
  error?: unknown,
): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    at: serverTimestamp,
    dryRun: !tally.mutateEnabled,
    docsScanned: tally.scanned,
    docsCleared: tally.mutateEnabled ? tally.clearable : 0,
    docsWouldClear: tally.clearable,
    docsWouldClearByGroup: { ...tally.wouldClearByGroup },
    docsSkipped: tally.skipped,
    budgetAbort: tally.budgetAbort,
    fullPassCompleted: tally.fullPassCompleted,
  };
  if (error !== undefined && error !== null) {
    rec.error = true;
    rec.errorMessage = errorToMessage(error);
  }
  return rec;
}

/**
 * Best-effort human-readable message for an audit record's `errorMessage`. Bounded
 * so a pathological error string can't bloat the state doc.
 */
export function errorToMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
}
