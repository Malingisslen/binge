/**
 * Binge community ratings (BIN-104) — maintains a per-title aggregate
 * {count, sum} of user ratings, NOT a per-view fan-out across users (that would
 * blow the 25 SEK/mån cap). Mirrors the insights-rollup philosophy: write-time
 * maintenance, read-time is a single cheap doc.
 *
 * Fires on every watchlist write but no-ops unless the doc's `rating` changed
 * (the common case). A transaction + a stored `lastEventId` (BIN-148) makes
 * redelivery of the *same* event idempotent so the aggregate can't drift.
 * Aggregate doc id is `${mediaType}_${tmdbId}` so a movie and a TV show that
 * share a TMDB numeric id never collide.
 *
 * The aggregate collection is Admin-written only (rules: read public, write
 * false). avg is computed on read as sum / count.
 *
 * WHERE THE LOGIC LIVES (BIN-727, condition 4). This file is now only the PORT
 * plus the trigger wrapper: it opens the transaction and shapes the event, and
 * decides nothing. The doc-id derivation (the vote-stuffing invariant), the
 * no-op guard, the duplicate check and the arithmetic all live in ./runAggregate.ts,
 * which imports no firebase-admin and is therefore drivable by
 * src/test/rules/community-ratings-orchestrator.test.ts against a real Firestore
 * emulator — including a forced write/write race that makes the transaction
 * actually retry.
 *
 * `runTransaction` below MUST stay a thin pass-through to the Admin SDK's own
 * transaction. A buffered "read now, commit later" shim would satisfy the port's
 * type and silently drop the atomicity the whole guard rests on; runAggregate.ts's
 * header says so at length, and the contention test is what enforces it.
 *
 * BIN-727 also removed `FieldValue.increment` from the write. That is safe only
 * because the transaction already reads this document for `lastEventId` — see
 * runAggregate.ts for the full argument and the two changes that would break it.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { runCommunityRatingAggregate, type AggregateIo } from './runAggregate';

const COLLECTION = 'titleRatingsAggregate';

/** The production port: the real Admin transaction, and nothing else. */
const adminIo: AggregateIo = {
  log: logger,
  runTransaction: (fn) => {
    const db = getFirestore();
    return db.runTransaction(async (tx) => fn({
      get: async (docId) => {
        const snap = await tx.get(db.collection(COLLECTION).doc(docId));
        return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
      },
      // merge:true — the aggregate doc may carry fields this code doesn't own.
      // `updatedAt` is stamped here, not by the orchestrator, so no SDK-specific
      // sentinel ever crosses the port boundary.
      set: (docId, data) => {
        tx.set(
          db.collection(COLLECTION).doc(docId),
          { ...data, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      },
    }));
  },
};

export const communityRatingMaintain = onDocumentWritten(
  'users/{uid}/watchlist/{tmdbId}',
  async (event) => {
    await runCommunityRatingAggregate(adminIo, {
      eventId: event.id,
      // The watchlist doc's OWN id — a path segment, never a body field. That is
      // the whole vote-stuffing invariant; runAggregate.ts explains why.
      watchlistDocId: event.params.tmdbId,
      before: event.data?.before.data(),
      after: event.data?.after.data(),
    });
  },
);
