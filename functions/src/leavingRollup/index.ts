/**
 * BIN-178 — "vad försvinner" rollup. onSchedule daily (europe-west1). Queries
 * MOTN's /changes endpoint for what's EXPIRING in SE within ~31 days (the right
 * source — it returns the actual leaving list per service, not gated by which
 * titles we track per-title), collapses it into ONE small public doc
 * streamingLeaving/current.byProvider keyed by canonical TMDB provider id, which
 * the /forsvinner/[provider] page reads client-side (one doc) and enriches via
 * TMDB. streamingLeaving needs a public-read rule + client-never-write.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { fetchExpiringChanges } from './motnChanges';
import { buildLeavingRollupFromChanges } from './logic';
import { stockholmDayId, motnBillingCycleId } from '../util/dayId';
import { applyThrottleObservation, notifyOnceForCycle, reserveMotnSlot, sendAdminSystemNotification } from '../util/notifyOnce';

const MOTN_API_KEY = defineSecret('MOTN_API_KEY');
const ADMIN_UID = defineSecret('ADMIN_UID');

const WINDOW_DAYS = 31; // MOTN caps the changes window at 31 days ahead

// BIN-541 (2026-07-17): this job shares MOTN's real 500-requests/MONTH vendor
// account with streamingOffers (see functions/src/streamingOffers/index.ts for
// the full quota story) but, until now, spent it with NO accounting at all —
// up to MAX_PAGES (20, see motnChanges.ts) unmetered calls a day.
// LEAVING_HARD_CYCLE_CAP is this job's own slice of the conservative ~450-of-500
// combined safe pool (streamingOffers takes the other 300) — its own Firestore
// counter, separate from streamingOffers', so neither job can starve the other.
//
// Known residual (code review, 2026-07-17, filed as a follow-up rather than
// fixed here — BIN-543): unlike streamingOffers' per-title batch (which can
// shrink its per-run selection without losing correctness — each title's
// write is independently complete), this job needs a FULL pagination pass to
// produce one meaningful snapshot. A hard per-run page cap sized to survive
// the whole ~31-day cycle (150/31 ≈ 5 pages/run) would make any day with
// genuinely more than ~5 pages of real expiring content permanently
// "incomplete" — under the completeness guard below, that would silently
// freeze the public rollup forever instead of just going stale sometimes,
// which is worse than the bug it would fix. A correct fix needs a persisted
// pagination cursor so a run can RESUME across days instead of restarting
// from page 0 — a real redesign, not a constant tweak. Until then: MAX_PAGES
// (motnChanges.ts) stays as a safety ceiling only; LEAVING_HARD_CYCLE_CAP is
// what actually bounds vendor spend (never exceeded, by construction of the
// reservation gate below), and if genuine daily demand is high enough to
// exhaust it before the cycle resets, the rollup goes stale for the rest of
// that cycle rather than overspending.
const LEAVING_HARD_CYCLE_CAP = 150;

/** Cloud Scheduler is at-least-once; skip if we already ran within the last 20 hours (mirrors streamingOffersRefresh). */
const IDEMPOTENCY_WINDOW_MS = 20 * 60 * 60 * 1000;

async function notifyAdminLeavingStale(): Promise<boolean> {
  return sendAdminSystemNotification(
    '"Vad försvinner": MOTN-kvot slut för perioden',
    'leavingRollup kunde inte hämta ny data den här körningen — kvoten för denna faktureringsperiod är slut. Sidan visar tills vidare den senaste hämtade listan.',
  );
}

export const leavingRollup = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '256MiB', secrets: [MOTN_API_KEY, ADMIN_UID] },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const toSec = nowSec + WINDOW_DAYS * 24 * 60 * 60;
    // BIN-350: "generated on" label shown to Swedish users → Stockholm wall-clock
    // day. (The per-title leaving dates inside byProvider come from MOTN's own
    // timestamps via isoFromUnix and stay UTC — those are data-dates, not a bucket.)
    const today = stockholmDayId();

    // Own billing-cycle-keyed counter, separate from streamingOffers' — see
    // motnBillingCycleId's doc comment for why the anchor is a working
    // assumption, not a confirmed fact.
    const motnCycle = motnBillingCycleId(new Date(nowMs));
    const budgetRef = db.collection('motnLeavingBudget').doc(motnCycle);
    const budgetSnap = await budgetRef.get();
    const usedThisCycle = (budgetSnap.get('count') as number | undefined) ?? 0;

    // Cloud Scheduler is at-least-once — a retry within this window is treated
    // as a duplicate and skipped (mirrors streamingOffersRefresh).
    //
    // Code review (2026-07-17), round 3: `lastRunAt` must be written AFTER the
    // risky pagination work, not before it. A prior version wrote it here,
    // up front — if the run then crashed/timed out mid-pagination (the exact
    // scenario this guard exists to police), a genuine Scheduler retry would
    // see the just-written `lastRunAt`, wrongly treat the crashed run as
    // "already handled", and skip for the full 20h with zero progress. Moved
    // to right after fetchExpiringChanges resolves (below) — same point
    // streamingOffersRefresh's equivalent guard writes at (only once the risky
    // network work has actually returned, not before starting it).
    const lastRunAt = budgetSnap.get('lastRunAt') as number | undefined;
    if (lastRunAt !== undefined && nowMs - lastRunAt < IDEMPOTENCY_WINDOW_MS) {
      logger.info('leavingRollup: skipping duplicate run (within 20h window)', { lastRunAt, nowMs });
      return;
    }

    if (usedThisCycle >= LEAVING_HARD_CYCLE_CAP) {
      logger.warn('leavingRollup: MOTN cycle cap already reached — skipping run', { motnCycle, usedThisCycle });
      // Cheap, no risky I/O involved — safe to stamp lastRunAt here directly.
      await notifyOnceForCycle(budgetRef, notifyAdminLeavingStale, { lastRunAt: nowMs });
      return;
    }

    const canFetchPage = (): Promise<boolean> => reserveMotnSlot(budgetRef, LEAVING_HARD_CYCLE_CAP);

    const result = await fetchExpiringChanges(nowSec, toSec, canFetchPage);
    // The risky network work has returned (successfully, even if its own
    // result is incomplete) — safe to mark this invocation as handled now.
    await budgetRef.set({ lastRunAt: nowMs, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    // Code review: 'clean' only if we actually got a real (non-429) vendor
    // response this run — zero pages fetched (budget denied before any HTTP
    // call, or the API-key-missing null case) proves nothing and must not
    // reset an in-progress 429-confirmation streak (reserveThrottleSignal
    // treats that as 'no_signal').
    const observation = result?.rateLimited ? 'rate_limited' : (result?.pagesFetched ?? 0) > 0 ? 'clean' : 'no_signal';
    await applyThrottleObservation(budgetRef, observation, LEAVING_HARD_CYCLE_CAP, notifyAdminLeavingStale, { motnCycle });

    if (!result) {
      logger.error('leavingRollup: MOTN changes returned no data (no API key); leaving previous rollup intact');
      return;
    }
    // Code review: `complete` (motnChanges.ts) is the single source of truth
    // for "was this a full, trustworthy pagination pass" — true only when
    // pagination reached its genuine natural end. Any other exit (429, our
    // own budget denial, a plain network/5xx error mid-pagination, a
    // malformed hasMore/nextCursor response) leaves it false, so a truncated
    // pull can never silently overwrite the public rollup with an
    // under-reported list — whether it ended up empty or partial-but-nonzero.
    if (!result.complete) {
      logger.warn('leavingRollup: run did not complete a full pagination pass — leaving previous rollup intact', {
        motnCycle, rateLimited: result.rateLimited, pagesFetched: result.pagesFetched, changesFetched: result.changes.length,
      });
      return;
    }

    const rollup = buildLeavingRollupFromChanges(result.changes, result.shows);
    const providerCount = Object.keys(rollup.byProvider).length;
    const titleCount = Object.values(rollup.byProvider).reduce((n, list) => n + list.length, 0);

    await db.collection('streamingLeaving').doc('current').set({
      byProvider: rollup.byProvider,
      today,
      generatedAt: FieldValue.serverTimestamp(),
    });

    logger.info('leavingRollup done', { changes: result.changes.length, providers: providerCount, titles: titleCount });
  },
);
