/**
 * Callable report-submit (BIN-49).
 *
 * Replaces the client writeBatch + rules-based throttle (BIN-25), which gated
 * per *batch* and could be bypassed by packing ~499 report-creates into one
 * batch. Report creation now goes through this server-authoritative callable;
 * the `reports` create rule is locked to `if false` so clients can't write
 * directly — only this function (Admin SDK, bypasses rules) can.
 *
 * The cooldown is enforced inside a transaction on
 * users/{uid}/reportMeta/throttle, so concurrent calls from the same uid
 * serialize on that doc and can't race past the limit. reporterUid comes from
 * the authenticated context, never the payload.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { validateReportInput, isWithinCooldown } from './logic';

export const submitReport = onCall({ region: 'europe-west1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Du måste vara inloggad för att rapportera.');

  const parsed = validateReportInput(request.data);
  if (!parsed.ok) throw new HttpsError('invalid-argument', parsed.error);
  const report = parsed.value;

  const db = getFirestore();
  const throttleRef = db.doc(`users/${uid}/reportMeta/throttle`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(throttleRef);
    const raw = snap.get('lastReportAt');
    const lastMs = raw instanceof Timestamp ? raw.toMillis() : null;

    if (isWithinCooldown(lastMs, Date.now())) {
      // Not a transient error → propagates out of runTransaction without retry,
      // aborting the write. Surfaces to the client as functions/resource-exhausted.
      throw new HttpsError('resource-exhausted', 'Vänta lite innan du rapporterar igen.');
    }

    tx.set(throttleRef, { lastReportAt: FieldValue.serverTimestamp() });
    tx.set(db.collection('reports').doc(), {
      reporterUid: uid,
      targetType: report.targetType,
      targetId: report.targetId,
      targetOwnerUid: report.targetOwnerUid,
      reason: report.reason,
      ...(report.note ? { note: report.note } : {}),
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
});
