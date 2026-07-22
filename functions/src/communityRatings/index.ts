/**
 * Binge community ratings (BIN-104) — maintains a per-title aggregate
 * {count, sum} of user ratings, NOT a per-view fan-out across users (that would
 * blow the 25 SEK/mån cap). Mirrors the insights-rollup philosophy: write-time
 * maintenance, read-time is a single cheap doc.
 *
 * Fires on every watchlist write but no-ops unless the doc's `rating` changed
 * (the common case). Uses FieldValue.increment for atomic, lock-free deltas —
 * concurrent rating writes for distinct events compose correctly. A transaction
 * + a stored `lastEventId` (BIN-148) makes redelivery of the *same* event
 * idempotent so the aggregate can't drift. Aggregate doc id is
 * `${mediaType}_${tmdbId}` so a movie and a TV show that share a TMDB numeric id
 * never collide.
 *
 * The aggregate collection is Admin-written only (rules: read public, write
 * false). avg is computed on read as sum / count.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { ratingDelta, isNoOp } from './logic';
import { mediaTypeDocId, parseMediaTypeFromDocId } from '../shared/mediaTypeDocId';

export const communityRatingMaintain = onDocumentWritten(
  'users/{uid}/watchlist/{tmdbId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const delta = ratingDelta(before?.rating, after?.rating);
    if (isNoOp(delta)) return;

    // BIN-560 Phase 4 — the aggregate doc id is derived from the watchlist doc's
    // PATH, never its body. This is the vote-stuffing invariant the rules comment
    // (`titleRatingsAggregate` is "never client-written"): Firestore enforces one doc
    // per path, so a path-derived aggregate key = at most one rating per account per
    // title. Reading the tmdbId from the user-writable BODY (which rules whitelist but
    // never value-bind) would decouple the key from the unique path — a user could
    // create N docs under different itemIds, each carrying a spoofed `{tmdbId: X}`, and
    // each would independently increment titleRatingsAggregate/X. Post-cutover the doc
    // id already IS `${mediaType}_${tmdbId}`, so it is the aggregate id verbatim.
    const docIdRaw = event.params.tmdbId;
    const pathMediaType = parseMediaTypeFromDocId(docIdRaw);
    let docId: string;
    if (pathMediaType != null) {
      docId = docIdRaw; // namespaced doc id == aggregate id (path-unique → no stuffing)
    } else {
      // Legacy bare-numeric doc id (pre-cutover; the Fork-A reset means none exist —
      // defense-in-depth). Preserve the ORIGINAL trust model: tmdbId from the PATH
      // (docIdRaw, still path-unique), prefix from the body's mediaType. A wrong body
      // mediaType only mis-buckets that one doc's single vote; it cannot stuff a real
      // aggregate, because the id part is still the unique path segment.
      const bodyMediaType = (after?.mediaType ?? before?.mediaType) as string | undefined;
      if (bodyMediaType !== 'movie' && bodyMediaType !== 'tv') {
        logger.warn(`communityRatings: skipping ${docIdRaw} — unknown mediaType`);
        return;
      }
      docId = mediaTypeDocId(bodyMediaType, docIdRaw);
    }
    const ref = getFirestore().collection('titleRatingsAggregate').doc(docId);
    try {
      // BIN-148: onDocumentWritten is at-least-once — a redelivered event would
      // apply the same delta twice and drift count/sum permanently. Guard with
      // the CloudEvent id in a transaction: skip if we already processed it.
      await getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.get('lastEventId') === event.id) {
          logger.info(`communityRatings: duplicate event ${event.id} for ${docId} — skipping`);
          return;
        }
        tx.set(ref, {
          count: FieldValue.increment(delta.countDelta),
          sum: FieldValue.increment(delta.sumDelta),
          lastEventId: event.id,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    } catch (err) {
      logger.error(`communityRatings: aggregate update failed for ${docId}`, err);
    }
  },
);
