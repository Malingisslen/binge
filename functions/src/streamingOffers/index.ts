// functions/src/streamingOffers/index.ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { isIntentTitle, dedupeIntent, selectRefreshBatch, computeHealth, streamingOffersDocId } from './logic';
import { fetchOffers, RATE_LIMITED } from './motn';
import { cheapestRent, appendPricePoint, type PricePoint } from './priceHistory';
import { mediaTypeDocId } from '../shared/mediaTypeDocId';
import { motnBillingCycleId } from '../util/dayId';
import { applyThrottleObservation, notifyOnceForCycle, reserveMotnSlot, sendAdminSystemNotification } from '../util/notifyOnce';
import type { IntentItem, ExistingOffer, Offer, WorkItem } from './types';

const MOTN_API_KEY = defineSecret('MOTN_API_KEY');
const ADMIN_UID = defineSecret('ADMIN_UID');

// BIN-541 (2026-07-17): MOTN's real Basic plan is 500 requests/MONTH, hard limit
// — BIN-320's "100/day" was never verified and was wrong on both period and
// size. STREAMING_HARD_CYCLE_CAP is this job's own slice of a conservative
// ~450-of-500 combined safe pool shared with leavingRollup (its other consumer
// of the same vendor account, functions/src/leavingRollup — sees its own
// LEAVING_HARD_CYCLE_CAP=150 there); 300 here leaves headroom for library
// growth while keeping the combined total well under the vendor's real cap.
//
// PER_RUN_SELECT bounds how many titles a single run attempts. Code review
// (2026-07-17): this MUST be sized so the cycle cap survives the WHOLE cycle,
// not just part of it — the first version set it to 20 "for catch-up headroom"
// without checking that 20/run × ~15 runs already exhausts 300, going dark for
// the back half of every cycle. A billing cycle anchored on a given day can run
// up to 31 days (e.g. Dec 21 → Jan 21), so PER_RUN_SELECT × 31 must stay ≤
// STREAMING_HARD_CYCLE_CAP: 9 × 31 = 279 ≤ 300, with a bit of slack left over.
// This same value also feeds computeHealth() below as the real sustainable
// per-day throughput (it used to receive this same constant back when the
// vendor cap really was daily and the two concepts were still the same
// number — that coupling is intentional, not a leftover to "fix").
const STREAMING_HARD_CYCLE_CAP = 300;
const PER_RUN_SELECT = 9;
const PAGE_SIZE = 2000;

/** Scan all watchlist docs, narrowed, and keep only intent titles, deduped. */
async function readWorkSet(): Promise<WorkItem[]> {
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

/**
 * Read current streamingOffers state for prioritization (acceptable full read at
 * this scale).
 *
 * BIN-523: identity comes from the doc's `tmdbId`/`mediaType` FIELDS, never from
 * parsing the doc id. That's what lets legacy bare-`${tmdbId}` docs keep counting
 * as "already checked" after the id scheme changed — without it every title in
 * the library would look never-checked at once and the governor would burn the
 * whole 300-call monthly MOTN budget re-fetching data it already has.
 */
async function readExisting(): Promise<ExistingOffer[]> {
  const db = getFirestore();
  const snap = await db.collection('streamingOffers').select('checkedAt', 'offers', 'tmdbId', 'mediaType').get();
  const out: ExistingOffer[] = [];
  for (const d of snap.docs) {
    // Recover the media type from the doc ID when the field is missing or junk —
    // the same defence the tmdbId line below already had. Dropping the row
    // instead (the pre-2026-07-20 behaviour) silently reclassified the title as
    // tier-0 "never checked", the HIGHEST refresh priority, so a handful of
    // malformed docs could burn the month's MOTN budget re-fetching data we
    // already hold. Only a bare-id doc with an unusable field is truly
    // unattributable, and that is the one case we still have to skip.
    const field = d.get('mediaType');
    const fromId = d.id.startsWith('movie_') ? 'movie' : d.id.startsWith('tv_') ? 'tv' : null;
    const mediaType = field === 'movie' || field === 'tv' ? field : fromId;
    if (mediaType === null) continue;
    const tmdbId = Number(d.get('tmdbId') ?? Number(d.id));
    if (!Number.isFinite(tmdbId)) continue;
    const offers = (d.get('offers') as Offer[] | undefined) ?? [];
    const leavings = offers.map((o) => o.leaving).filter((l): l is string => !!l).sort();
    out.push({
      tmdbId,
      mediaType,
      checkedAt: Number(d.get('checkedAt') ?? 0),
      nextLeaving: leavings[0] ?? null,
    });
  }
  return out;
}

async function notifyAdmin(status: 'warn' | 'critical', intervalDays: number, users: number): Promise<boolean> {
  return sendAdminSystemNotification(
    status === 'critical' ? 'Streaming-data: gratistaket nått' : 'Streaming-data närmar sig gratistaket',
    `Uppdateringstakt ~${intervalDays} dagar (≈${users} användare). Överväg MOTN Pro ($39/mån) för veckovis uppdatering.`,
  );
  // FCM push reuses the existing sendPushToUser helper if desired (see episodeNotify).
}

/**
 * BIN-541 security review: the "already exhausted" early-return used to skip
 * any admin signal entirely — harmless when the cap was daily (next run just
 * retried ~24h later), but now that the cap is monthly, that silent window
 * could last up to ~a month. Fired via the shared notifyOnceForCycle helper
 * (functions/src/util/notifyOnce.ts) so it happens exactly once per cycle.
 */
async function notifyAdminStreamingStale(): Promise<boolean> {
  return sendAdminSystemNotification(
    'Streaming-data: MOTN-kvot slut för perioden',
    'streamingOffersRefresh kunde inte hämta ny data — kvoten för denna faktureringsperiod är slut. Titlarnas tillgänglighet visar tills vidare senaste kända data.',
  );
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

    // BIN-541: MOTN-quota counter keyed by the vendor's billing cycle (monthly,
    // anchored to the subscription's start date — NOT a UTC calendar month, and
    // NOT the Stockholm day-id askbinge uses). See motnBillingCycleId's doc
    // comment for why the anchor is a working assumption, not a confirmed fact.
    const motnCycle = motnBillingCycleId(new Date(nowMs));
    const budgetRef = db.collection('motnBudget').doc(motnCycle);
    const budgetSnap = await budgetRef.get();
    const usedThisCycle = (budgetSnap.get('count') as number | undefined) ?? 0;
    if (usedThisCycle >= STREAMING_HARD_CYCLE_CAP) {
      logger.warn('streamingOffersRefresh: MOTN cycle cap already reached — skipping run', { motnCycle, usedThisCycle });
      await notifyOnceForCycle(budgetRef, notifyAdminStreamingStale);
      return;
    }

    const workSet = await readWorkSet();
    const existing = await readExisting();
    const batch = selectRefreshBatch(workSet, existing, nowMs, PER_RUN_SELECT);

    // BIN-545: the batch carries (tmdbId, mediaType) pairs. It used to be bare
    // ids resolved through a tmdbId-keyed Map, which re-collapsed movie N and
    // TV N right after dedupeIntent had been fixed to keep them apart.
    let written = 0;
    let sawRateLimited = false;
    let sawClean = false; // at least one real (non-429, non-null) vendor response this run
    for (const { tmdbId, mediaType } of batch) {
      // Reserve a MOTN slot for this billing cycle BEFORE spending the call (a
      // crash + Scheduler retry can't overshoot the cap). Never refunded on
      // failure — the vendor counts the request, not the success.
      const granted = await reserveMotnSlot(budgetRef, STREAMING_HARD_CYCLE_CAP);
      if (!granted) {
        logger.warn('streamingOffersRefresh: MOTN cycle cap reached mid-run — stopping', { motnCycle });
        break;
      }
      const result = await fetchOffers(tmdbId, mediaType);
      if (result === RATE_LIMITED) {
        // 429: could be the real monthly quota gone, or a transient trip of the
        // vendor's separate hourly rate limit. Don't burn the bucket here —
        // reserveThrottleSignal below only confirms exhaustion (and burns to
        // the cap) once a SECOND run in a row also sees a 429.
        sawRateLimited = true;
        logger.warn('streamingOffersRefresh: MOTN 429 — stopping this run (confirms after a repeat)', { motnCycle });
        break;
      }
      if (result === null) continue; // per-title failure -> retry next run
      sawClean = true;
      const offers = result;
      await db.collection('streamingOffers').doc(streamingOffersDocId(mediaType, tmdbId)).set({
        tmdbId, mediaType, offers, checkedAt: nowMs, source: 'motn',
      });
      written += 1;

      // The namespaced doc now supersedes the legacy bare-id one, so retire it.
      // Without this, readExisting's full-collection scan carries ~2 rows per
      // title FOREVER — it runs unpaginated every 24h, so it is the worst
      // standing cost in the pipeline. Gated on the legacy doc's own mediaType:
      // a movie and a show sharing a tmdbId want the SAME bare doc, and deleting
      // one unconditionally would destroy the sibling's only data path.
      const legacyRef = db.collection('streamingOffers').doc(String(tmdbId));
      const legacySnap = await legacyRef.get();
      if (legacySnap.exists && legacySnap.get('mediaType') === mediaType) {
        await legacyRef.delete();
      }

      // BIN-180: capture cheapest-rent price history (shared, global, write-on-
      // change). Builds the price-graph asset that can't be backfilled. One read
      // + (only on a price change) one write per batched title — bounded by the
      // daily budget, so negligible cost.
      //
      // BIN-562 (2026-07-20): priceHistory is namespaced by (mediaType, tmdbId)
      // like every other per-title collection. It was the LAST bare-keyed one,
      // and leaving it that way was actively harmful, not merely untidy:
      // priceDropNotify scans only films, so a movie's push quoted whatever the
      // same-numeric-id TV show had last recorded. Writer and BOTH readers
      // (priceDropNotify, usePriceHistory) changed together — shipping the write
      // alone would take every price chart dark for a refresh cycle.
      const histRef = db.collection('priceHistory').doc(mediaTypeDocId(mediaType, tmdbId));
      // Seed from the legacy bare-id doc on the FIRST namespaced write, using the
      // same mediaType gate the readers use. Without this the new doc starts
      // empty, appendPricePoint has no `last` to compare against, and the title's
      // whole accumulated series is orphaned the moment the namespaced doc exists
      // (both readers stop falling back). Price history is the one asset here
      // that cannot be backfilled — see this module's header.
      let points = (await histRef.get()).get('points') as PricePoint[] | undefined;
      if (points === undefined) {
        const legacyHist = await db.collection('priceHistory').doc(String(tmdbId)).get();
        if (legacyHist.exists && legacyHist.get('mediaType') === mediaType) {
          points = legacyHist.get('points') as PricePoint[] | undefined;
        }
      }
      points = points ?? [];
      const nextPoints = appendPricePoint(points, cheapestRent(offers), nowMs);
      if (nextPoints) {
        await histRef.set({ tmdbId, mediaType, points: nextPoints, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }

    // BIN-541: persist the 429 streak; only burn the bucket to the cap once
    // confirmed across two runs (see reserveThrottleSignal's doc comment).
    // Code review: an empty batch or all-per-title-failures run (sawClean
    // stays false, sawRateLimited stays false) proves nothing about the
    // vendor's quota and must not reset an in-progress confirmation streak.
    const observation = sawRateLimited ? 'rate_limited' : sawClean ? 'clean' : 'no_signal';
    await applyThrottleObservation(budgetRef, observation, STREAMING_HARD_CYCLE_CAP, notifyAdminStreamingStale, { motnCycle });

    const health = computeHealth(workSet.length, PER_RUN_SELECT, new Date(nowMs).toISOString());
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
