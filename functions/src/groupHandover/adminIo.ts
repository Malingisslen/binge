/**
 * The Admin-SDK implementation of `HandoverIo` (BIN-1063 steg 3).
 *
 * Its own module because BOTH doors use it: the `handOverOwnedGroups` callable
 * and `retentionCleanup`'s field-owned sweep. Two implementations that merely
 * looked equivalent would be the drift this whole ticket exists to prevent —
 * one door handing a group to a different member than the other.
 *
 * `db` and `log` are injected rather than reached for, so a caller that already
 * holds them does not open a second handle.
 */

import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { type HandoverIo } from './runHandover';

/** Writes per batch, under Firestore's own 500 ceiling. */
const BATCH_LIMIT = 450;

/** One Admin-SDK operation per method, no decisions. */
export function adminHandoverIo(db: Firestore, log: HandoverIo['log']): HandoverIo {
  return {
    log,

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
      // Firestore commits at most 500 writes per batch, and the writes here grow
      // with the watchlist, which nothing bounds.
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
