// functions/src/streamingOffers/index.ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { isIntentTitle, dedupeIntent, selectRefreshBatch, computeHealth } from './logic';
import { fetchOffers } from './motn';
import { cheapestRent, appendPricePoint, type PricePoint } from './priceHistory';
import type { IntentItem, ExistingOffer, Offer } from './types';

const MOTN_API_KEY = defineSecret('MOTN_API_KEY');
const ADMIN_UID = defineSecret('ADMIN_UID');

const DAILY_BUDGET = 95;
const PAGE_SIZE = 2000;

/** Scan all watchlist docs, narrowed, and keep only intent titles, deduped. */
async function readWorkSet(): Promise<{ tmdbId: number; mediaType: 'movie' | 'tv' }[]> {
  const db = getFirestore();
  const items: IntentItem[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    // orderBy('status') — not orderBy('__name__') — so Firestore only returns docs
    // that HAVE a 'status' field; this naturally excludes groups/{id}/watchlist docs
    // (which have no status) while keeping all user watchlist docs (even legacy-status ones).
    let q = db.collectionGroup('watchlist')
      .select('mediaType', 'status', 'tmdbId', 'providers')
      .orderBy('status').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const x = d.data();
      const it: IntentItem = {
        tmdbId: Number(x.tmdbId ?? Number(d.id)),
        mediaType: String(x.mediaType ?? ''),
        status: String(x.status ?? ''),
        providers: Array.isArray(x.providers) ? (x.providers as number[]) : [],
      };
      if (isIntentTitle(it)) items.push(it);
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return dedupeIntent(items);
}

/** Read current streamingOffers state for prioritization (acceptable full read at this scale). */
async function readExisting(): Promise<ExistingOffer[]> {
  const db = getFirestore();
  const snap = await db.collection('streamingOffers').select('checkedAt', 'offers').get();
  return snap.docs.map((d) => {
    const offers = (d.get('offers') as Offer[] | undefined) ?? [];
    const leavings = offers.map((o) => o.leaving).filter((l): l is string => !!l).sort();
    return {
      tmdbId: Number(d.id),
      checkedAt: Number(d.get('checkedAt') ?? 0),
      nextLeaving: leavings[0] ?? null,
    };
  });
}

async function notifyAdmin(status: 'warn' | 'critical', intervalDays: number, users: number): Promise<void> {
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) return;
  const db = getFirestore();
  await db.collection('users').doc(adminUid).collection('notifications').add({
    kind: 'system',
    title: status === 'critical' ? 'Streaming-data: gratistaket nått' : 'Streaming-data närmar sig gratistaket',
    body: `Uppdateringstakt ~${intervalDays} dagar (≈${users} användare). Överväg MOTN Pro ($39/mån) för veckovis uppdatering.`,
    actionUrl: '/insikter',
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  // FCM push reuses the existing sendPushToUser helper if desired (see episodeNotify).
}

/** Cloud Scheduler is at-least-once; skip if we already ran within the last 20 hours. */
const IDEMPOTENCY_WINDOW_MS = 20 * 60 * 60 * 1000; // 20h — safe margin below 24h schedule

export const streamingOffersRefresh = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [MOTN_API_KEY, ADMIN_UID] },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    // Idempotency guard: reject same-day Scheduler retries.
    const healthSnap = await db.collection('streamingHealth').doc('current').get();
    const lastRunAt = healthSnap.exists ? (healthSnap.get('lastRunAt') as number | undefined) : undefined;
    if (lastRunAt !== undefined && nowMs - lastRunAt < IDEMPOTENCY_WINDOW_MS) {
      logger.info('streamingOffersRefresh: skipping duplicate run (within 20h window)', { lastRunAt, nowMs });
      return;
    }

    const workSet = await readWorkSet();
    const existing = await readExisting();
    const batch = selectRefreshBatch(workSet, existing, nowMs, DAILY_BUDGET);

    const mediaById = new Map(workSet.map((w) => [w.tmdbId, w.mediaType]));
    let written = 0;
    for (const tmdbId of batch) {
      const mediaType = mediaById.get(tmdbId)!;
      const offers = await fetchOffers(tmdbId, mediaType);
      if (offers === null) continue; // failure -> retry next run
      await db.collection('streamingOffers').doc(String(tmdbId)).set({
        tmdbId, mediaType, offers, checkedAt: nowMs, source: 'motn',
      });
      written += 1;

      // BIN-180: capture cheapest-rent price history (shared, global, write-on-
      // change). Builds the price-graph asset that can't be backfilled. One read
      // + (only on a price change) one write per batched title — bounded by the
      // daily budget, so negligible cost.
      const histRef = db.collection('priceHistory').doc(String(tmdbId));
      const points = ((await histRef.get()).get('points') as PricePoint[] | undefined) ?? [];
      const nextPoints = appendPricePoint(points, cheapestRent(offers), nowMs);
      if (nextPoints) {
        await histRef.set({ tmdbId, mediaType, points: nextPoints, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }

    const health = computeHealth(workSet.length, DAILY_BUDGET, new Date(nowMs).toISOString());
    const prev = (await db.collection('streamingHealth').doc('current').get()).data();
    await db.collection('streamingHealth').doc('current').set({ ...health, lastRunAt: nowMs });
    if ((health.status === 'warn' || health.status === 'critical') && prev?.status !== health.status) {
      const users = (await db.collection('users').count().get()).data().count;
      await notifyAdmin(health.status, health.refreshIntervalDays, users);
    }

    logger.info('streamingOffersRefresh done', {
      workSet: workSet.length, attempted: batch.length, written, status: health.status, intervalDays: health.refreshIntervalDays,
    });
  },
);
