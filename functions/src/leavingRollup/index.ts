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
import { stockholmDayId } from '../util/dayId';

const MOTN_API_KEY = defineSecret('MOTN_API_KEY');

const WINDOW_DAYS = 31; // MOTN caps the changes window at 31 days ahead

export const leavingRollup = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '256MiB', secrets: [MOTN_API_KEY] },
  async () => {
    const db = getFirestore();
    const nowSec = Math.floor(Date.now() / 1000);
    const toSec = nowSec + WINDOW_DAYS * 24 * 60 * 60;
    // BIN-350: "generated on" label shown to Swedish users → Stockholm wall-clock
    // day. (The per-title leaving dates inside byProvider come from MOTN's own
    // timestamps via isoFromUnix and stay UTC — those are data-dates, not a bucket.)
    const today = stockholmDayId();

    const result = await fetchExpiringChanges(nowSec, toSec);
    if (!result) {
      logger.error('leavingRollup: MOTN changes returned no data; leaving previous rollup intact');
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
