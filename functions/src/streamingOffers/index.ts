// functions/src/streamingOffers/index.ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { isIntentTitle, dedupeIntent, selectRefreshBatch, computeHealth, streamingOffersDocId, classifyRunOutcome, nextRunsWithoutSuccess } from './logic';
import { fetchOffers, RATE_LIMITED, REQUEST_REJECTED } from './motn';
import { cheapestRent, appendPricePoint, type PricePoint } from './priceHistory';
import { mediaTypeDocId, parseMediaTypeFromDocId, resolveTmdbId } from '../shared/mediaTypeDocId';
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
        tmdbId: resolveTmdbId(x.tmdbId as number | string | null | undefined, d.id),
        mediaType: String(x.mediaType ?? ''),
        status: String(x.status ?? ''),
        providers: Array.isArray(x.providers) ? (x.providers as number[]) : [],
      };
      // BIN-856: isIntentTitle also rejects a non-finite tmdbId — see its own
      // comment for why such an item would otherwise burn a vendor call every
      // run forever. The guard lives in logic.ts so logic.test.ts can pin it.
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
    const fromId = parseMediaTypeFromDocId(d.id);
    const mediaType = field === 'movie' || field === 'tv' ? field : fromId;
    if (mediaType === null) continue;
    const tmdbId = resolveTmdbId(d.get('tmdbId') as number | string | null | undefined, d.id);
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

/**
 * BIN-856 (2026-08-12, Malin's option B): the feed is not delivering. Kept
 * separate from notifyAdmin above, which is about outgrowing the free tier and
 * would be actively misleading here — nothing about a paid plan fixes a broken
 * request. This is the message that should have arrived on 2026-07-13.
 */
async function notifyAdminFeedDown(
  status: 'warn' | 'critical',
  runsWithoutSuccess: number,
  reason: string | null,
): Promise<boolean> {
  const why = reason === 'request-rejected'
    ? 'Leverantören avvisar våra anrop — se felmeddelandet i loggen.'
    : 'Inget av anropen gav användbart svar.';
  return sendAdminSystemNotification(
    status === 'critical' ? 'Streaming-data: flödet är dött' : 'Streaming-data: inget nytt kommer in',
    `${runsWithoutSuccess} körningar i rad utan en enda lyckad hämtning. ${why} Titlarnas tillgänglighet visar tills vidare senaste kända data.`,
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
    let sawRejected = false; // the vendor refused the request we built (BIN-856)
    // BIN-856: vendor calls actually SPENT, which is not the same as batch.length
    // now that a rejected request breaks the loop early. This is the number that
    // matters against the monthly cap, so it's the number the closing log reports.
    let attempted = 0;
    for (const { tmdbId, mediaType } of batch) {
      // Reserve a MOTN slot for this billing cycle BEFORE spending the call (a
      // crash + Scheduler retry can't overshoot the cap). Never refunded on
      // failure — the vendor counts the request, not the success.
      const granted = await reserveMotnSlot(budgetRef, STREAMING_HARD_CYCLE_CAP);
      if (!granted) {
        logger.warn('streamingOffersRefresh: MOTN cycle cap reached mid-run — stopping', { motnCycle });
        break;
      }
      attempted += 1;
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
      // BIN-856: the vendor rejected the request we BUILT (4xx that isn't 404
      // or 429 — see classifyStatus). That's our defect, not this title's, so
      // every remaining title in the batch would fail identically while each
      // one still consumes a reserved vendor slot. Stop immediately: the
      // `output_language=sv` build spent 198 of the 300-call monthly cap this
      // way, nine identical 400s a day, because a rejected request was
      // indistinguishable from an ordinary per-title miss.
      if (result === REQUEST_REJECTED) {
        sawRejected = true;
        logger.error('streamingOffersRefresh: MOTN rejected our request — stopping run to stop burning vendor quota', { motnCycle, attempted });
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

    // BIN-856 (Malin's option B): carry the delivery streak forward from the
    // snapshot taken at the TOP of this run — `healthSnap`, read before any of
    // the work below — and fold this run's outcome into it. Read from that
    // snapshot rather than re-reading now, so the value can't be disturbed by
    // anything this run did.
    const outcome = classifyRunOutcome(attempted, sawClean, sawRateLimited);
    const prevRuns = (healthSnap.get('runsWithoutSuccess') as number | undefined) ?? 0;
    const prevSuccessAt = (healthSnap.get('lastSuccessAt') as number | undefined) ?? null;
    const delivery = {
      runsWithoutSuccess: nextRunsWithoutSuccess(prevRuns, outcome),
      lastSuccessAt: outcome === 'delivered' ? nowMs : prevSuccessAt,
      // Coarse on purpose — the vendor's own sentence goes to the log (motn.ts).
      // This field only has to say WHICH kind of silence this was.
      lastFailureReason: outcome === 'no-delivery' ? (sawRejected ? 'request-rejected' : 'no-usable-response') : null,
    };

    const health = computeHealth(workSet.length, PER_RUN_SELECT, new Date(nowMs).toISOString(), delivery);
    // Same snapshot the streak came from, not a second read: one question
    // deserves one answer, and re-reading would take the alarm's edge-trigger
    // from a LATER snapshot than the counter it is comparing — inconsistent if
    // the doc ever did move mid-run. Also one Firestore read cheaper.
    const prev = healthSnap.data();
    // `.set()` without merge — every field the doc should keep must be in
    // `health`, which is why DeliveryState is part of HealthDoc rather than
    // written separately.
    await db.collection('streamingHealth').doc('current').set({ ...health, lastRunAt: nowMs });

    // Two alarms, deliberately NOT one. The capacity message tells her to
    // consider a paid MOTN plan because the library outgrew the free tier —
    // exactly the wrong advice when the truth is that the feed is broken. Each
    // fires on its own sub-status changing, so a red `status` always arrives
    // with the right explanation attached.
    // `prev.capacityStatus` doesn't exist on a document written before this
    // change, so fall back to the legacy `status` — which WAS the capacity
    // status, exactly. Without it the first run after deploy would re-send a
    // warning she already has, on a library that was already over the line.
    const prevCapacity = prev?.capacityStatus ?? prev?.status;
    if ((health.capacityStatus === 'warn' || health.capacityStatus === 'critical')
        && prevCapacity !== health.capacityStatus) {
      const users = (await db.collection('users').count().get()).data().count;
      await notifyAdmin(health.capacityStatus, health.refreshIntervalDays, users);
    }
    if ((health.feedStatus === 'warn' || health.feedStatus === 'critical')
        && prev?.feedStatus !== health.feedStatus) {
      await notifyAdminFeedDown(health.feedStatus, health.runsWithoutSuccess, health.lastFailureReason);
    }

    logger.info('streamingOffersRefresh done', {
      workSet: workSet.length, batch: batch.length, attempted, written,
      status: health.status, capacityStatus: health.capacityStatus, feedStatus: health.feedStatus,
      runsWithoutSuccess: health.runsWithoutSuccess, outcome,
      intervalDays: health.refreshIntervalDays,
    });
  },
);
