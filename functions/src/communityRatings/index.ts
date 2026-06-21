/**
 * Binge community ratings (BIN-104) — maintains a per-title aggregate
 * {count, sum} of user ratings, NOT a per-view fan-out across users (that would
 * blow the 25 SEK/mån cap). Mirrors the insights-rollup philosophy: write-time
 * maintenance, read-time is a single cheap doc.
 *
 * Fires on every watchlist write but no-ops unless the doc's `rating` changed
 * (the common case). Uses FieldValue.increment for atomic, lock-free updates —
 * concurrent rating writes for the same title compose correctly without a
 * transaction. Aggregate doc id is `${mediaType}_${tmdbId}` so a movie and a TV
 * show that share a TMDB numeric id never collide.
 *
 * The aggregate collection is Admin-written only (rules: read public, write
 * false). avg is computed on read as sum / count.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { ratingDelta, isNoOp } from './logic';

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

    const docId = `${mediaType}_${event.params.tmdbId}`;
    try {
      await getFirestore().collection('titleRatingsAggregate').doc(docId).set({
        count: FieldValue.increment(delta.countDelta),
        sum: FieldValue.increment(delta.sumDelta),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      logger.error(`communityRatings: aggregate update failed for ${docId}`, err);
    }
  },
);
