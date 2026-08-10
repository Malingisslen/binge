/**
 * Scheduled Insikter rollup.
 *
 * Runs a few times a day, aggregates current-state Firestore data into a single
 * `insights/daily` document (+ a dated `insights/{YYYY-MM-DD}` for history). The
 * /api/insights endpoint then reads only that one document per page load, so the
 * dashboard costs ~1 read per visit instead of a full collection scan.
 *
 * Cost note: the heavy part is the collectionGroup('watchlist') scan — one read
 * per watchlist doc. /insikter is an internal admin dashboard, so it runs once a
 * day (BIN-156; was every 6h = 4×/day against the 25 SEK/mån Blaze cap). Fields
 * are narrowed with .select() to cut egress and the scan is paginated (PAGE_SIZE)
 * so peak memory stays bounded as the library grows.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { resolveTmdbId } from '../shared/mediaTypeDocId';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import {
  statusDistribution,
  mediaTypeSplit,
  ratingsHistogram,
  tallyTop,
} from './aggregate';
import type { RollupData } from './types';
// BIN-326: pure helpers live in rollup.helpers.ts (no firebase-admin import) so
// they unit-test under the root vitest toolchain — see that file's header.
import { topTitles, expiredInsightDocIds, canonicalProviderId, type WatchlistLite, tallyProviderIds } from './rollup.helpers';
// BIN-350: dated history doc-id keys on the Stockholm wall-clock day so it agrees
// with the /insikter reader range BIN-343 already switched to Stockholm (otherwise
// the near-midnight baseline read can land a day off the UTC-keyed rollup doc).
import { stockholmDayId } from '../util/dayId';

/** Page size for the bounded scan (BIN-156) — mirrors the sibling watchlist
 *  scanners (streamingOffers/retentionCleanup/reclaimOrphanFollows). Never
 *  materialize the whole collection-group in one query result. */
const PAGE_SIZE = 2000;

// BIN-326: keep dated history bounded. insights/{YYYY-MM-DD} is written every
// run; without a sweep it grows one doc/day forever against the 25 SEK cap.
// 90 days is plenty for the Fas-2 trend charts.
const RETENTION_DAYS = 90;

/** Read every watchlist doc (narrowed fields) across all users, paginated. */
async function readWatchlist(): Promise<WatchlistLite[]> {
  const db = getFirestore();
  const out: WatchlistLite[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db
      .collectionGroup('watchlist')
      .select('status', 'mediaType', 'rating', 'title', 'tmdbId', 'providers', 'subscriptionProviders', 'genreIds')
      .orderBy('__name__')
      .limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    for (const d of snap.docs) {
      const x = d.data();
      out.push({
        status: String(x.status ?? ''),
        mediaType: String(x.mediaType ?? ''),
        rating: typeof x.rating === 'number' ? x.rating : null,
        title: String(x.title ?? ''),
        tmdbId: resolveTmdbId(x.tmdbId as number | string | null | undefined, d.id),
        providers: Array.isArray(x.providers) ? (x.providers as number[]) : [],
        // BIN-845: null (not []) when absent — a doc written before BIN-814 split
        // the field has no subscription answer, and falling back to the broad one
        // is right there. `[]` would mean "checked, covered by nothing", which is
        // a different claim.
        subscriptionProviders: Array.isArray(x.subscriptionProviders)
          ? (x.subscriptionProviders as number[])
          : null,
        genreIds: Array.isArray(x.genreIds) ? (x.genreIds as number[]) : [],
      });
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}

/** Count a collection cheaply with the aggregation API (1 read). */
async function countCollection(group: 'collection' | 'collectionGroup', name: string): Promise<number> {
  const db = getFirestore();
  const ref = group === 'collection' ? db.collection(name) : db.collectionGroup(name);
  const agg = await ref.count().get();
  return agg.data().count;
}

async function countActiveSessions(): Promise<number> {
  const db = getFirestore();
  const agg = await db
    .collection('sessions')
    .where('expiresAt', '>', Timestamp.now())
    .count()
    .get();
  return agg.data().count;
}

export async function computeRollup(): Promise<RollupData> {
  let partial = false;

  let watchlist: WatchlistLite[] = [];
  try {
    watchlist = await readWatchlist();
  } catch (err) {
    logger.error('rollup: watchlist scan failed', err);
    partial = true;
  }

  const safeCount = async (fn: () => Promise<number>): Promise<number> => {
    try {
      return await fn();
    } catch (err) {
      logger.error('rollup: count failed', err);
      partial = true;
      return 0;
    }
  };

  const [users, reviews, groups, activeSessions] = await Promise.all([
    safeCount(() => countCollection('collection', 'users')),
    safeCount(() => countCollection('collection', 'reviews')),
    safeCount(() => countCollection('collection', 'groups')),
    safeCount(() => countActiveSessions()),
  ]);

  // Fold TMDB's alias ids onto the canonical service before tallying, so a
  // service stored under several ids (e.g. Max = 384/1899/1825 across docs of
  // different vintages) counts as ONE row instead of splitting the panel.
  // BIN-845: the subscription subset, mirroring the client's own stats page. This
  // tally answers "which services carry what people track", and since BIN-814 the
  // broad `providers` field also holds rent and buy — counting those would inflate
  // every rent-store-adjacent service. Rows written before the split have no subset
  // and fall back to the broad array, same rule the client uses.
  const providers = watchlist.flatMap(tallyProviderIds).map(canonicalProviderId);
  const genres = watchlist.flatMap((w) => w.genreIds);

  return {
    computedAt: new Date().toISOString(),
    totals: {
      users,
      titlesTracked: watchlist.length,
      reviews,
      activeSessions,
      groups,
    },
    statusDistribution: statusDistribution(watchlist),
    mediaTypeSplit: mediaTypeSplit(watchlist),
    ratingsHistogram: ratingsHistogram(watchlist),
    topTitles: topTitles(watchlist, 10),
    topProviders: tallyTop(providers, 10).map((t) => ({ providerId: t.value, count: t.count })),
    topGenres: tallyTop(genres, 10).map((t) => ({ genreId: t.value, count: t.count })),
    // 4 aggregation reads + one read per watchlist doc.
    readsUsed: watchlist.length + 4,
    partial,
  };
}

/**
 * Scheduled entrypoint. Writes insights/daily (the live snapshot the API reads)
 * and insights/{YYYY-MM-DD} (history for Fas 2 trend charts).
 */
export const rollupInsights = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const rollup = await computeRollup();
    const db = getFirestore();
    // Stockholm day-id (BIN-350). The same dateId flows into expiredInsightDocIds
    // below, so the history write + retention sweep stay on one timezone basis.
    // One-time cutover blip: the day this flips UTC→Stockholm, a single history
    // doc may land under an adjacent date-id. Harmless — each rollup is a full
    // current-state snapshot (idempotent), never an additive per-day counter, so
    // no reporting day is double-counted or dropped.
    const dateId = stockholmDayId(new Date(rollup.computedAt));
    await Promise.all([
      db.collection('insights').doc('daily').set(rollup),
      db.collection('insights').doc(dateId).set(rollup),
    ]);

    // BIN-326: sweep dated history older than the retention window so the
    // collection can't grow unbounded. listDocuments() returns refs without
    // per-doc reads; best-effort (a failed sweep never blocks the rollup write).
    let pruned = 0;
    try {
      const refs = await db.collection('insights').listDocuments();
      const expired = new Set(expiredInsightDocIds(refs.map((r) => r.id), dateId, RETENTION_DAYS));
      const toDelete = refs.filter((r) => expired.has(r.id));
      if (toDelete.length > 0) {
        const batch = db.batch();
        for (const ref of toDelete) batch.delete(ref);
        await batch.commit();
        pruned = toDelete.length;
      }
    } catch (err) {
      logger.error('rollup: history retention sweep failed', err);
    }

    logger.info('rollup written', {
      titlesTracked: rollup.totals.titlesTracked,
      users: rollup.totals.users,
      readsUsed: rollup.readsUsed,
      partial: rollup.partial,
      prunedHistoryDocs: pruned,
    });
  },
);
