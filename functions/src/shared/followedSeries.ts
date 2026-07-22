/**
 * Shared paginated reader: every TV title in 'mina' across all users' watchlists.
 *
 * Used by both episodeReleaseNotify and showReturnNotify, which previously each
 * ran an UNBOUNDED `.collectionGroup('watchlist')…get()` — the whole matching
 * collection-group materialized in one shot. At scale that is one uncapped read
 * in a single query, can exceed Firestore's 10 MB single-response limit (a hard
 * error that aborts the entire notify run → no notifications sent), and holds
 * the full result set in function memory.
 *
 * This mirrors the streamingOffers reader's bounded loop (BIN-294). The two
 * equality filters (mediaType + status) are served by the existing
 * (mediaType, status) COLLECTION_GROUP composite index; ordering by document id
 * rides that index's implicit __name__ tail, so the limit/startAfter cursor
 * needs NO new index. Behaviour is unchanged — same docs, same shape — just
 * bounded reads.
 */

import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { resolveTmdbId } from './mediaTypeDocId';
import type { WatchlistLite } from '../episodeNotify/logic';

const PAGE_SIZE = 2000;

export async function readFollowedSeries(): Promise<WatchlistLite[]> {
  const db = getFirestore();
  const out: WatchlistLite[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db.collectionGroup('watchlist')
      .where('mediaType', '==', 'tv').where('status', '==', 'mina')
      .select('mediaType', 'status', 'title', 'tmdbId', 'lastWatchedSeason', 'lastWatchedEpisode', 'tmdbStatus')
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const x = d.data();
      const uid = d.ref.parent.parent?.id ?? '';
      out.push({
        uid, tmdbId: resolveTmdbId(x.tmdbId as number | string | null | undefined, d.id), mediaType: String(x.mediaType ?? ''),
        status: String(x.status ?? ''), title: String(x.title ?? ''),
        lastWatchedSeason: typeof x.lastWatchedSeason === 'number' ? x.lastWatchedSeason : null,
        lastWatchedEpisode: typeof x.lastWatchedEpisode === 'number' ? x.lastWatchedEpisode : null,
        tmdbStatus: typeof x.tmdbStatus === 'string' ? x.tmdbStatus : null,
      });
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}
