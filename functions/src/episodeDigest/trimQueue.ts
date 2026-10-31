/**
 * Bounds the morning-digest queue (BIN-1475) even when episodeMorningDigest
 * stops running. The queue only grows through episodeReleaseNotify, so that job
 * trims it: entries older than MAX_QUEUE_AGE_MS go, and with them the uids of
 * people who may have deleted their account since. The state doc itself stays,
 * because it also holds the lastNotifiedEpisode marker; deleting it would queue
 * the latest episode a second time.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { settlePending, type PendingEpisode } from './logic';

export async function trimStaleQueue(nowMs: number): Promise<number> {
  const db = getFirestore();
  const snap = await db.collection('episodeNotifyState').where('hasPending', '==', true).get();
  let trimmed = 0;
  for (const d of snap.docs) {
    const seen = d.get('pending');
    // Nothing stale in the snapshot: skip the transaction's extra read. A stale
    // entry cannot appear later, so a fresh-looking doc needs no second look.
    if (Array.isArray(seen) && settlePending(seen as PendingEpisode[], new Set(), new Set(), nowMs).length === seen.length) continue;
    const ref = db.collection('episodeNotifyState').doc(d.id);
    try {
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).get('pending');
        const list = Array.isArray(current) ? (current as PendingEpisode[]) : [];
        const rest = settlePending(list, new Set(), new Set(), nowMs);
        if (rest.length === list.length) return;
        trimmed += 1;
        if (rest.length === 0) tx.update(ref, { pending: FieldValue.delete(), hasPending: FieldValue.delete() });
        else tx.update(ref, { pending: rest });
      });
    } catch (err) { logger.error(`trimStaleQueue: ${d.id} failed`, err); }
  }
  logger.info('trimStaleQueue done', { pendingDocs: snap.size, trimmed });
  return trimmed;
}
