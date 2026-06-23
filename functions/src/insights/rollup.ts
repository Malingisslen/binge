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
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import {
  statusDistribution,
  mediaTypeSplit,
  ratingsHistogram,
  tallyTop,
} from './aggregate';
import type { RollupData, MediaType } from './types';

interface WatchlistLite {
  status: string;
  mediaType: string;
  rating: number | null;
  title: string;
  tmdbId: number;
  providers: number[];
  genreIds: number[];
}

/** Page size for the bounded scan (BIN-156) — mirrors the sibling watchlist
 *  scanners (streamingOffers/retentionCleanup/reclaimOrphanFollows). Never
 *  materialize the whole collection-group in one query result. */
const PAGE_SIZE = 2000;

/** Read every watchlist doc (narrowed fields) across all users, paginated. */
async function readWatchlist(): Promise<WatchlistLite[]> {
  const db = getFirestore();
  const out: WatchlistLite[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db
      .collectionGroup('watchlist')
      .select('status', 'mediaType', 'rating', 'title', 'tmdbId', 'providers', 'genreIds')
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
        tmdbId: Number(x.tmdbId ?? Number(d.id)),
        providers: Array.isArray(x.providers) ? (x.providers as number[]) : [],
        genreIds: Array.isArray(x.genreIds) ? (x.genreIds as number[]) : [],
      });
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}

/** Top tracked titles, keyed by tmdbId so we can carry the denormalized title. */
function topTitles(
  items: WatchlistLite[],
  limit: number,
): RollupData['topTitles'] {
  const byId = new Map<number, { tmdbId: number; mediaType: MediaType; title: string; count: number }>();
  for (const it of items) {
    const existing = byId.get(it.tmdbId);
    if (existing) {
      existing.count += 1;
    } else {
      byId.set(it.tmdbId, {
        tmdbId: it.tmdbId,
        mediaType: (it.mediaType === 'tv' ? 'tv' : 'movie') as MediaType,
        title: it.title,
        count: 1,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.count - a.count).slice(0, limit);
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

  const providers = watchlist.flatMap((w) => w.providers);
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
    const dateId = rollup.computedAt.slice(0, 10);
    await Promise.all([
      db.collection('insights').doc('daily').set(rollup),
      db.collection('insights').doc(dateId).set(rollup),
    ]);
    logger.info('rollup written', {
      titlesTracked: rollup.totals.titlesTracked,
      users: rollup.totals.users,
      readsUsed: rollup.readsUsed,
      partial: rollup.partial,
    });
  },
);
