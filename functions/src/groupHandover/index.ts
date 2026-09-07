/**
 * Callable group handover (BIN-1063 steg 3).
 *
 * Malin's decision of 2026-09-06: a group whose owner leaves is handed to the
 * longest-standing remaining member, never deleted, and that holds for both doors
 * — this callable, which the account-delete button calls before its cascade, and
 * the retention sweep, which will drive the same `runGroupHandover` through its
 * own port.
 *
 * It is a callable rather than a client write because `ownerUid` is pinned
 * unchanged on every `groups/{groupId}` update branch in `firestore.rules`, and
 * because rules cannot iterate a subcollection to check that the successor really
 * is the longest-standing member. A branch loose enough to permit the write would
 * leave that guarantee in client code.
 *
 * The uid comes from the authenticated context and is never read from the
 * payload: a caller can only ever hand over their OWN groups.
 *
 * Reachable by any signed-in caller, not only from the delete flow, and that is
 * intended. It is self-only and strictly weaker than the `allow delete` an owner
 * already holds on their own group. It does remove the caller from the groups it
 * hands over, and the rules forbid an owner adding a uid back to `memberUids`, so
 * getting back in needs a fresh invite.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { refusalForHandover } from './logic';
import { runGroupHandover, type HandoverIo } from './runHandover';

/** Writes per batch, under Firestore's own 500 ceiling. */
const BATCH_LIMIT = 450;

/** The production port: one Admin-SDK operation per method, no decisions. */
function adminIo(): HandoverIo {
  const db = getFirestore();
  return {
    log: logger,

    ownedGroupIds: async (uid) => {
      const snap = await db.collection('groups').where('ownerUid', '==', uid).get();
      return snap.docs.map((d) => d.id);
    },

    readGroup: async (groupId) => {
      const snap = await db.doc(`groups/${groupId}`).get();
      if (!snap.exists) return null;
      return {
        ownerUid: (snap.get('ownerUid') as string | undefined) ?? '',
        memberUids: (snap.get('memberUids') as string[] | undefined) ?? [],
      };
    },

    readMembers: async (groupId) => {
      const snap = await db.collection(`groups/${groupId}/members`).get();
      return snap.docs.map((d) => {
        const raw = d.get('joinedAt');
        return { uid: d.id, joinedAtMs: raw instanceof Timestamp ? raw.toMillis() : null };
      });
    },

    readWatchlist: async (groupId) => {
      const snap = await db.collection(`groups/${groupId}/watchlist`).get();
      return snap.docs.map((d) => ({ id: d.id, addedBy: d.get('addedBy') }));
    },

    readSessionHistory: async (groupId) => {
      const snap = await db.collection(`groups/${groupId}/sessionHistory`).get();
      return snap.docs.map((d) => ({
        id: d.id,
        pickedByUid: d.get('pickedByUid'),
        participantUids: (d.get('participantUids') as string[] | undefined) ?? [],
      }));
    },

    claimOwnership: async (groupId, expectedOwnerUid, write) => {
      const groupRef = db.doc(`groups/${groupId}`);
      return db.runTransaction(async (tx) => {
        // The re-read is the idempotency guard, and it has to be inside the
        // transaction: a retry must find its own earlier handover already done
        // rather than hold a second election naming a different member.
        const fresh = await tx.get(groupRef);
        if (!fresh.exists || fresh.get('ownerUid') !== expectedOwnerUid) return false;
        tx.update(groupRef, {
          ownerUid: write.ownerUid,
          memberUids: write.memberUids,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
    },

    eraseMemberTraces: async (groupId, leavingUid, erasure) => {
      const groupRef = db.doc(`groups/${groupId}`);
      // Firestore commits at most 500 writes per batch. The member and household
      // deletes are two; the rest grow with the watchlist, which nothing bounds.
      //
      // The deletes are no-ops on a document that is already gone, so a retry
      // converges. The `addedBy` removal is an `update` and DOES throw if the row
      // was deleted meanwhile — that fails this group, which the loop counts and
      // reports rather than swallowing. A merging `set` would be worse: on a
      // deleted row it would resurrect a ghost carrying nothing but a tombstone.
      let batch = db.batch();
      let queued = 0;
      const flush = async () => {
        if (queued > 0) { await batch.commit(); batch = db.batch(); queued = 0; }
      };

      const queue = async (fn: (b: FirebaseFirestore.WriteBatch) => void) => {
        fn(batch);
        queued += 1;
        if (queued >= BATCH_LIMIT) await flush();
      };

      await queue((b) => b.delete(groupRef.collection('members').doc(leavingUid)));
      await queue((b) => b.delete(groupRef.collection('household').doc(leavingUid)));
      // BIN-329: a joinAttempts row holds a plaintext invite token.
      await queue((b) => b.delete(groupRef.collection('joinAttempts').doc(leavingUid)));
      for (const itemId of erasure.itemIds) {
        await queue((b) => b.delete(
          groupRef.collection('watchlist').doc(itemId).collection('progress').doc(leavingUid),
        ));
      }
      for (const itemId of erasure.clearAddedByIds) {
        await queue((b) => b.update(
          groupRef.collection('watchlist').doc(itemId),
          { addedBy: FieldValue.delete() },
        ));
      }
      for (const rowId of erasure.clearPickedByIds) {
        await queue((b) => b.update(
          groupRef.collection('sessionHistory').doc(rowId),
          { pickedByUid: FieldValue.delete() },
        ));
      }
      for (const rowId of erasure.dropParticipantIds) {
        await queue((b) => b.update(
          groupRef.collection('sessionHistory').doc(rowId),
          { participantUids: FieldValue.arrayRemove(leavingUid) },
        ));
      }
      await flush();
    },
  };
}

// `timeoutSeconds` is raised off the 60s default because the loop issues one
// `progress/{uid}` delete per watchlist row across every owned group, and nothing
// bounds that. It narrows the window in which the function is killed mid-loop —
// it cannot close it, and a kill returns no summary, so the caller classifies
// that failure as untouched. See the deviations entry.
export const handOverOwnedGroups = onCall(
  { region: 'europe-west1', timeoutSeconds: 300 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Du måste vara inloggad.');

    const summary = await runGroupHandover(adminIo(), uid);

    // A per-group failure is counted rather than thrown, so the rest of the
    // groups still get handed over. But the CALLER must not fall through: its
    // next step deletes what it still owns, and a group that failed here is a
    // group other people are still in. The predicate lives in `logic.ts` so a
    // test can call it.
    const refusal = refusalForHandover(summary);
    if (refusal) {
      throw new HttpsError('internal', refusal);
    }
    return summary;
  },
);
