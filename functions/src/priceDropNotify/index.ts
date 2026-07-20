/**
 * BIN-180 — price-drop push ("Dune är nu 39 kr, lägsta på 6 mån").
 *
 * onSchedule('every 24 hours', europe-west1). Scans collectionGroup('watchlist')
 * for films in 'vill_se' (the titles users intend to watch), groups by tmdbId,
 * reads the shared priceHistory/{tmdbId}.points (captured by streamingOffersRefresh),
 * and — when detectPriceDrop sees a FRESH cheapest-rent drop — pushes the owners
 * who opted into price alerts (notificationSettings.priceDrops + pushEnabled).
 *
 * Dedup marker: priceDropNotifyState/{tmdbId}.lastNotifiedDropAt = the `at` of the
 * point we alerted on. At-most-once per distinct drop; the marker advances even on
 * an empty recipient set (same contract as availableNotify). Admin SDK bypasses
 * firestore.rules, so priceDropNotifyState needs no rule change.
 *
 * No TMDB calls — it reads only already-captured price history, so it's cheap.
 */

import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendPushToUser } from '../push';
import { detectPriceDrop } from '../streamingOffers/priceDrop';
import type { PricePoint } from '../streamingOffers/priceHistory';
import { mediaTypeDocId } from '../shared/mediaTypeDocId';

interface WantedFilm {
  uid: string;
  tmdbId: number;
  title: string;
}

// BIN-515: bounded scan (was a single unbounded `.get()`). At scale the whole
// matching collection-group in one query is an uncapped read-bill that can breach
// Firestore's 10 MB single-response limit — a hard error that aborts the daily run
// so no price-drop pushes go out. Mirrors streamingOffers / followedSeries. The two
// equality filters (status + mediaType) are served by the existing (mediaType,
// status) COLLECTION_GROUP composite index; ordering by document id rides its
// implicit __name__ tail, so the cursor needs NO new index. Same docs, same shape.
const PAGE_SIZE = 2000;

async function readWantedFilms(): Promise<WantedFilm[]> {
  const db = getFirestore();
  const out: WantedFilm[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db.collectionGroup('watchlist')
      .where('status', '==', 'vill_se')
      .where('mediaType', '==', 'movie')
      .select('mediaType', 'status', 'title', 'tmdbId')
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const x = d.data();
      out.push({
        uid: d.ref.parent.parent?.id ?? '',
        tmdbId: Number(x.tmdbId ?? Number(d.id)),
        title: String(x.title ?? ''),
      });
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}

interface NotifySettings { priceDrops: boolean; pushEnabled: boolean }

// Both opt-in (default OFF). Fetched ONCE per distinct uid up front — a popular
// title shared by N users would otherwise re-read the same user-doc per title.
async function readSettingsByUid(uids: Iterable<string>): Promise<Map<string, NotifySettings>> {
  const db = getFirestore();
  const unique = [...new Set([...uids].filter(Boolean))];
  const map = new Map<string, NotifySettings>();
  await Promise.all(unique.map(async (uid) => {
    const snap = await db.collection('users').doc(uid).get();
    const s = snap.exists
      ? (snap.data()?.notificationSettings as { priceDrops?: boolean; pushEnabled?: boolean } | undefined)
      : undefined;
    map.set(uid, { priceDrops: s?.priceDrops === true, pushEnabled: s?.pushEnabled === true });
  }));
  return map;
}

async function processTitle(
  tmdbId: number, items: WantedFilm[], nowMs: number, settingsByUid: Map<string, NotifySettings>,
): Promise<number> {
  const db = getFirestore();
  // BIN-562: priceHistory is namespaced by (mediaType, tmdbId). This function
  // only ever handles films, so read `movie_${tmdbId}` and fall back to a legacy
  // bare-id doc ONCE — and only when that doc's own mediaType says it really is
  // the film's series. Before namespacing, TV deterministically won the shared
  // bare key, so an ungated fallback is exactly how a film's push came to quote
  // an unrelated show's rent price.
  const histRef = db.collection('priceHistory').doc(mediaTypeDocId('movie', tmdbId));
  let histSnap = await histRef.get();
  if (!histSnap.exists) {
    const legacy = await db.collection('priceHistory').doc(String(tmdbId)).get();
    if (legacy.exists && legacy.get('mediaType') === 'movie') histSnap = legacy;
  }
  const points = (histSnap.get('points') as PricePoint[] | undefined) ?? [];

  const signal = detectPriceDrop(points, { nowMs });
  if (!signal) return 0;

  const dropAt = points[points.length - 1].at;
  const markerRef = db.collection('priceDropNotifyState').doc(String(tmdbId));
  const lastNotifiedDropAt = (await markerRef.get()).get('lastNotifiedDropAt') as number | undefined;
  if (lastNotifiedDropAt === dropAt) return 0; // already alerted this drop

  const actionUrl = `/movie/${tmdbId}/`;
  const lowBit = signal.isMultiMonthLow ? ' — lägsta på länge' : '';
  // Push-only (no inbox doc): the inbox model is tmdbId/provider-shaped and
  // coerces unknown kinds, so a price-drop entry would mis-render. The FCM push
  // carries the full message; a dedicated inbox kind is a follow-up.
  const recipients = items.filter((it) => settingsByUid.get(it.uid)?.priceDrops);
  const results = await Promise.allSettled(recipients.map(async (it) => {
    await sendPushToUser(it.uid, {
      title: 'Prisras',
      body: `${it.title} kan hyras för ${signal.amount} ${signal.currency}${lowBit}`,
      actionUrl,
      tag: `pricedrop-${tmdbId}`,
    }, { pushEnabled: settingsByUid.get(it.uid)!.pushEnabled });
    return 1;
  }));

  // Advance the marker even on an empty recipient set, so a drop isn't re-evaluated
  // every day (same dedup contract as availableNotify).
  await markerRef.set({ lastNotifiedDropAt: dropAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return results.filter((r) => r.status === 'fulfilled').length;
}

export const priceDropNotify = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    let films: WantedFilm[] = [];
    try { films = await readWantedFilms(); }
    catch (err) { logger.error('priceDropNotify: watchlist scan failed', err); return; }
    const byTitle = new Map<number, WantedFilm[]>();
    for (const it of films) { const arr = byTitle.get(it.tmdbId); if (arr) arr.push(it); else byTitle.set(it.tmdbId, [it]); }
    const nowMs = Date.now();
    // One settings read per distinct owner, reused across every title they want.
    const settingsByUid = await readSettingsByUid(films.map((f) => f.uid));
    let totalNotified = 0;
    for (const [tmdbId, items] of byTitle) {
      try { totalNotified += await processTitle(tmdbId, items, nowMs, settingsByUid); }
      catch (err) { logger.error(`priceDropNotify: title ${tmdbId} failed`, err); }
    }
    logger.info('priceDropNotify done', { wantedFilmDocs: films.length, uniqueTitles: byTitle.size, notified: totalNotified });
  },
);
