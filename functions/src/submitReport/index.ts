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
import { validateReportInput, isWithinCooldown, resolveTargetRef } from './logic';

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

    // BIN-292: derive the REAL owner server-side — never trust the client's
    // (forgeable) targetOwnerUid. Done INSIDE the transaction (after the cooldown
    // check, before any write) so it's gated by the throttle, not a free
    // ownership-lookup oracle. All reads precede the writes below.
    //
    // A deleted / missing / malformed target does NOT reject (it would lose a
    // legit report about since-deleted content — e.g. posted-then-deleted abuse):
    // we persist with targetOwnerUid=null + ownerResolved=false so the admin sees
    // "ägare okänd (innehållet borttaget)" rather than a forged/mis-attributed uid.
    const ref = resolveTargetRef(report.targetType, report.targetId);
    let targetOwnerUid: string | null = null;
    let ownerResolved = false;
    if (ref.kind === 'user') {
      // targetId IS the reported uid; soft-verify the account exists (don't reject
      // a report about a user mid-deletion — still has triage value).
      targetOwnerUid = ref.uid;
      ownerResolved = (await tx.get(db.doc(`users/${ref.uid}`))).exists;
    } else if (ref.kind === 'doc') {
      const targetSnap = await tx.get(db.doc(ref.path.join('/')));
      const owner = targetSnap.exists ? targetSnap.get('uid') : undefined;
      if (typeof owner === 'string' && owner.length > 0) {
        targetOwnerUid = owner;
        ownerResolved = true;
      }
    }

    tx.set(throttleRef, { lastReportAt: FieldValue.serverTimestamp() });
    tx.set(db.collection('reports').doc(), {
      reporterUid: uid,
      targetType: report.targetType,
      targetId: report.targetId,
      targetOwnerUid, // server-derived (null when the target is gone/unresolvable)
      ownerResolved,
      reason: report.reason,
      ...(report.note ? { note: report.note } : {}),
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
});
