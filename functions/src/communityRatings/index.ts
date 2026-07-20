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
import { mediaTypeDocId } from '../shared/mediaTypeDocId';

export const communityRatingMaintain = onDocumentWritten(
  'users/{uid}/watchlist/{tmdbId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const delta = ratingDelta(before?.rating, after?.rating);
    if (isNoOp(delta)) return;

    const mediaType = (after?.mediaType ?? before?.mediaType) as string | undefined;
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      logger.warn(`communityRatings: skipping ${event.params.tmdbId} — unknown mediaType`);
      return;
    }

    // Guarded above, so the shared helper's unknown→'tv' normalization can never
    // fire here — this call site deliberately SKIPS an unknown media type rather
    // than guessing one for an aggregate that can't be un-drifted (BIN-560).
    const docId = mediaTypeDocId(mediaType, event.params.tmdbId);
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
