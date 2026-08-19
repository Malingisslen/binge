/**
 * The communityRatings ORCHESTRATOR — the doc-id derivation and the transactional
 * read-check-write, lifted out of index.ts so a test can drive them (BIN-727,
 * condition 4 of the 2026-08-06 rescope).
 *
 * Why it lives here and not in index.ts: index.ts imports firebase-admin +
 * firebase-functions, and NEITHER is installed in the root toolchain (`npm ci` at
 * the repo root is all CI's `rules-tests` job installs — see
 * .github/workflows/ci.yml). So any file the emulator harness must import has to
 * be admin-free, exactly like ./logic.ts. index.ts implements the port with the
 * Admin SDK; `src/test/rules/community-ratings-orchestrator.test.ts` implements it
 * with the client SDK against a real Firestore emulator. Third use of the pattern
 * after retentionCleanup/runCleanup.ts and availableNotify/runNotify.ts.
 *
 * WHY THIS PORT EXPOSES A TRANSACTION, when its two predecessors expose only
 * primitive one-operation methods (#27 Database Administrator, 2026-08-15): the
 * invariant under test IS the atomicity. "The dedup check never leaves the
 * transaction that increments" cannot be expressed as a primitive without losing
 * the property being tested — a `applyDelta(docId, delta, eventId)` method would
 * move the whole decision into the port, where no test can see it. So the port
 * hands over the transaction and the callback body stays here.
 *
 * That shape has one hole, and only a test closes it: an implementation could
 * satisfy `runTransaction<T>(fn): Promise<T>` with a buffered non-transactional
 * shim — read now, collect writes, commit at the end. It would type-check and pass
 * every sequential test while dropping the entire guarantee. The contention test
 * in the spec is therefore load-bearing, not decorative: it asserts the callback
 * ran MORE THAN ONCE per racing pair, which is only true if a real optimistic
 * concurrency retry happened.
 *
 * WHY THERE IS NO `increment()` HERE, and what would make that unsafe (#27's
 * condition 1). The counts are computed as plain numbers from the transaction's
 * own read, not with `FieldValue.increment`. That is safe for exactly one reason:
 * the transaction ALREADY reads this document — it has to, to check `lastEventId`
 * — so Firestore's optimistic concurrency already guarantees the value we read is
 * the value we commit against. `increment` would buy nothing on top of that, and
 * making it a port method would push an SDK-specific opaque sentinel through the
 * orchestrator as `unknown`, where TypeScript could not stop an Admin sentinel and
 * a client sentinel being crossed. Two things would break the reasoning, and both
 * are changes someone could make without noticing:
 *   1. Removing the `tx.get` (e.g. "we don't need lastEventId any more"). Then
 *      there is no read to conflict on and two racing writers can lose an update.
 *   2. A SECOND writer of titleRatingsAggregate that does not go through this
 *      transaction. Today there is none — firestore.rules is `write: false` for
 *      clients and no other function or script touches the collection (verified
 *      2026-08-15) — and the aggregate is Admin-written only by design.
 * If either changes, put `FieldValue.increment` back, or make the new writer join
 * this transaction.
 */

import { ratingDelta, isNoOp, type AggregateDelta } from './logic';
import { mediaTypeDocId, parseMediaTypeFromDocId, parseTmdbIdFromDocId } from '../shared/mediaTypeDocId';

/** An arbitrary Firestore document's fields, as read back. */
export type DocData = Record<string, unknown>;

/** The subset of firebase-functions' logger this trigger uses. */
export interface AggregateLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * The transaction handle, narrowed to the two operations this callback performs.
 * `set` is always a MERGE — the aggregate doc may carry fields this code does not
 * own, and a full overwrite would silently drop them.
 */
export interface AggregateTx {
  /** `titleRatingsAggregate/{docId}`, or null when absent. Must be a transactional read. */
  get(docId: string): Promise<DocData | null>;
  /** Merge into `titleRatingsAggregate/{docId}`. The port stamps `updatedAt` itself. */
  set(docId: string, data: DocData): void;
}

/**
 * The injected port. `runTransaction` MUST be a thin pass-through to the SDK's own
 * transaction (`getFirestore().runTransaction` / `runTransaction(db, …)`) — never a
 * hand-rolled buffer-and-commit. See the header: nothing in this interface can
 * enforce that, only the contention test can.
 */
export interface AggregateIo {
  readonly log: AggregateLogger;
  runTransaction<T>(fn: (tx: AggregateTx) => Promise<T>): Promise<T>;
}

/** The trigger event, narrowed to what the decision needs. */
export interface RatingEvent {
  /** The CloudEvent id. At-least-once delivery means this can repeat (BIN-148). */
  readonly eventId: string;
  /** `event.params.tmdbId` — the watchlist doc's OWN id, i.e. a path segment. */
  readonly watchlistDocId: string;
  readonly before: DocData | undefined;
  readonly after: DocData | undefined;
}

/** What one delivery did, returned so a test can read it without parsing logs. */
export type AggregateOutcome =
  | { kind: 'noop' }                                    // the rating did not change
  // Both of aggregateDocId's null paths land here: a legacy bare id whose body carries
  // no usable mediaType, AND (since BIN-766) a doc id whose numeric part will not parse
  // to a positive integer. The NAME says only the first, which is a leftover — the two
  // are told apart by the `log.warn` text, and per BIN-915's accept that log is this
  // function's only observation channel, so keep them distinguishable there.
  | { kind: 'skipped-unknown-media-type' }
  | { kind: 'duplicate'; docId: string }                // this event was already applied
  | { kind: 'applied'; docId: string; count: number; sum: number }
  | { kind: 'failed'; docId: string };

/** A field read back as a finite number, or 0 — junk never poisons the running total. */
function numberOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * The aggregate doc id for a watchlist write, or null when it cannot be attributed.
 *
 * BIN-560 Phase 4 — derived from the watchlist doc's PATH, never its body. Reading
 * the tmdbId from the user-writable BODY (which rules whitelist but never
 * value-bind) would decouple the key from the unique path — a user could create N
 * docs under different itemIds, each carrying a spoofed `{tmdbId: X}`, and each
 * would independently increment titleRatingsAggregate/X.
 *
 * BIN-766 — what makes "at most one rating per account per title" true.
 * The path alone does NOT establish it, and the earlier version of this comment
 * claimed it did. Firestore enforces one doc per path, but MANY paths spell the
 * same title: `movie_42`, `movie_042`, `movie_0042`, … Before this fix the id was
 * returned verbatim, so those aliases FRAGMENTED into separate aggregate documents
 * — the bug this function was rewritten for: a real user's rating landed in an
 * average nobody reads. Canonicalising the numeric part fixes that, and in the same
 * motion funnels every alias onto one publicly-read document. That is strictly
 * worse than fragmentation unless something stops the aliases being created at all.
 *
 * That something is `firestore.rules`' create-only shape guard on
 * `users/{uid}/watchlist/{itemId}` (mirroring `canonicalSwipeDocId`, added in the
 * same commit). Path-derivation + that guard is the invariant; either one alone is
 * not. #4 Security Architect and #27 DBA both made the guard a binding condition
 * for this change, independently, and #6 DPO named the concrete consequence of
 * shipping without it: `MIN_SAMPLE = 5` means one account could push a title's
 * badge into existence on its own.
 *
 * The numeric part goes through `parseTmdbIdFromDocId`, never a hand-rolled parse:
 * that helper is strict-digits, so `movie_` and `movie_1_2` are NaN rather than the
 * `Number('') === 0` phantom (#7 QA named this as the mutation that survives a
 * naive finite-check). A non-finite or non-positive id is SKIPPED with a warning —
 * never written as `movie_NaN`, and never as `movie_0`, which BIN-646 established
 * is no genuine title. The guard is unconditional on purpose: BIN-624 may make the
 * server parser strict, turning `movie_042` into NaN instead of 42, and this code
 * must be correct either way rather than bound to that ticket's outcome.
 *
 * The legacy bare-numeric branch preserves the ORIGINAL trust model: the id part
 * still comes from the path, only the PREFIX comes from the body's mediaType — so a
 * wrong body mediaType mis-buckets that one doc's single vote and cannot stuff a
 * real aggregate. It is canonicalised too (`'042'` + body `movie` used to produce
 * `movie_042` by the other door). Kept as defence-in-depth — the Fork-A reset means
 * no bare ids exist in prod today — and tested rather than trusted: untested
 * defence-in-depth is the code nobody notices broke until it is exercised.
 */
export function aggregateDocId(event: RatingEvent, log: AggregateLogger): string | null {
  const docIdRaw = event.watchlistDocId;
  // Path prefix wins when it exists; the body is consulted ONLY for a legacy bare
  // id, which is what keeps a spoofed body mediaType from re-bucketing a namespaced
  // doc into the other media type's aggregate.
  const pathMediaType = parseMediaTypeFromDocId(docIdRaw);
  const mediaType = pathMediaType
    ?? ((event.after?.mediaType ?? event.before?.mediaType) as string | undefined);
  if (mediaType !== 'movie' && mediaType !== 'tv') {
    log.warn(`communityRatings: skipping ${docIdRaw} — unknown mediaType`);
    return null;
  }
  const tmdbId = parseTmdbIdFromDocId(docIdRaw);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
    log.warn(`communityRatings: skipping ${docIdRaw} — unparseable tmdbId`);
    return null;
  }
  return mediaTypeDocId(mediaType, tmdbId);
}

/**
 * Maintain the per-title `{count, sum}` aggregate for one watchlist write.
 *
 * No-ops unless the doc's `rating` changed (the common case — this trigger fires on
 * EVERY watchlist write). BIN-148: `onDocumentWritten` is at-least-once, so a
 * redelivered event would apply the same delta twice and drift the aggregate
 * permanently; the guard is the stored `lastEventId`, read and written inside ONE
 * transaction. Both halves must stay inside it — a check outside the transaction is
 * a check against a value that can change before the commit.
 *
 * The catch is deliberate and its cost is real: a swallowed failure means this
 * rating is permanently missing from the aggregate. It does NOT self-heal — a later
 * 4→5 edit carries `countDelta: 0`, so the count stays one short forever. What it
 * costs is a slightly-off average on one title, and it is logged as an error. The
 * alternative is `retry: true` on the trigger options, which is OFF by default in
 * firebase-functions v2 (options.d.ts, "Whether failed executions should be
 * delivered again") and is therefore NOT what a rethrow would buy today — a rethrow
 * with retry off changes nothing but the log line.
 *
 * DECIDED, so do not re-open it in a review: Malin accepted this risk on
 * 2026-08-16 (BIN-915, closed) rather than take the cost. Turning redelivery on
 * means `retry: true` on a trigger that fires on EVERY watchlist write, against a
 * 25 SEK/mån cap, to protect a display-only average. Full rationale and the
 * re-open trigger: `.claude/rules/accepted-deviations.md`. What is NOT accepted is
 * removing the `logger.error` below — the drift is invisible in the data, so that
 * log line is the only place this failure exists at all.
 */
export async function runCommunityRatingAggregate(
  io: AggregateIo,
  event: RatingEvent,
): Promise<AggregateOutcome> {
  const delta: AggregateDelta = ratingDelta(event.before?.rating, event.after?.rating);
  // Before ANY Firestore work: the overwhelming majority of watchlist writes do not
  // touch the rating, and a transaction per write would be a read-bill for nothing.
  if (isNoOp(delta)) return { kind: 'noop' };

  const docId = aggregateDocId(event, io.log);
  if (docId === null) return { kind: 'skipped-unknown-media-type' };

  try {
    return await io.runTransaction<AggregateOutcome>(async (tx) => {
      const current = await tx.get(docId);
      if (current !== null && current.lastEventId === event.eventId) {
        io.log.info(`communityRatings: duplicate event ${event.eventId} for ${docId} — skipping`);
        return { kind: 'duplicate', docId };
      }
      // Plain arithmetic on the value THIS transaction read — see the header for
      // why that is equivalent to FieldValue.increment here, and what would make
      // it stop being equivalent.
      const count = numberOr0(current?.count) + delta.countDelta;
      const sum = numberOr0(current?.sum) + delta.sumDelta;
      tx.set(docId, { count, sum, lastEventId: event.eventId });
      return { kind: 'applied', docId, count, sum };
    });
  } catch (err) {
    io.log.error(`communityRatings: aggregate update failed for ${docId}`, err);
    return { kind: 'failed', docId };
  }
}
