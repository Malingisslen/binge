/**
 * The Admin-SDK implementation of `HandoverIo` (BIN-1063 steg 3).
 *
 * Its own module because every door uses it. Two implementations that merely
 * looked equivalent would be the drift this whole ticket exists to prevent —
 * one door handing a group to a different member than the other. Derive the
 * doors rather than trusting a list here:
 *   git grep -n "adminHandoverIo(" -- functions src
 *
 * `db` and `log` are injected rather than reached for, so a caller that already
 * holds them does not open a second handle.
 */

import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { type HandoverIo, type HandoverNotifyIo, type LeaverIo, type MemberGroupsIo, type MemberStripIo } from './runHandover';
import { chunkWrites, leaverChunkMayCommit, memberTraceWrites, planClaim } from './logic';

/** Writes per batch, under Firestore's own 500 ceiling. */
const BATCH_LIMIT = 450;

/**
 * BIN-1118: the notification half of the owner-picked handover, as its own port
 * so the two doors that never notify do not have to implement it.
 *
 * `kind: 'system'` is an existing inbox card that the client already renders with
 * a title, a body and a link — reusing it means no client change and no second
 * card shape to keep in sync. Derive the reader rather than trusting this:
 *   grep -n "data.kind === 'system'" src/hooks/useNotifications.ts
 */
export function adminHandoverNotifyIo(db: Firestore): HandoverNotifyIo {
  return {
    readGroupName: async (groupId) => {
      const snap = await db.doc(`groups/${groupId}`).get();
      const name = snap.exists ? snap.get('name') : undefined;
      return typeof name === 'string' && name.length > 0 ? name : null;
    },

    readMemberName: async (groupId, uid) => {
      const snap = await db.doc(`groups/${groupId}/members/${uid}`).get();
      const name = snap.exists ? snap.get('displayName') : undefined;
      return typeof name === 'string' && name.length > 0 ? name : null;
    },

    notifyMembers: async (recipientUids, card) => {
      // One batch. The recipients are a group's members, a set the create rules
      // already bound well under the batch ceiling — unlike a watchlist, it
      // cannot grow unbounded.
      if (recipientUids.length === 0) return;
      const batch = db.batch();
      for (const uid of recipientUids) {
        batch.set(db.collection('users').doc(uid).collection('notifications').doc(), {
          kind: 'system',
          title: card.title,
          body: card.body,
          actionUrl: card.actionUrl,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    },
  };
}

/** One Admin-SDK operation per method, no decisions. */
export function adminHandoverIo(db: Firestore, log: HandoverIo['log']): HandoverIo {
  return {
    log,

    ownedGroupIds: async (uid) => {
      const snap = await db.collection('groups').where('ownerUid', '==', uid).get();
      return snap.docs.map((d) => d.id);
    },

    sentInvitePaths: async (uid) => {
      const snap = await db.collectionGroup('groupInvites').where('fromUid', '==', uid).select().get();
      return snap.docs.map((d) => d.ref.path);
    },

    // One batch, never chunked: `eraseSentInvites` refuses above the ceiling
    // rather than splitting, so a half-erased state cannot arise here.
    deleteSentInvites: async (paths) => {
      const batch = db.batch();
      paths.forEach((path) => batch.delete(db.doc(path)));
      await batch.commit();
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
        const claim = planClaim(fresh.exists ? {
          ownerUid: (fresh.get('ownerUid') as string | undefined) ?? '',
          memberUids: (fresh.get('memberUids') as string[] | undefined) ?? [],
        } : null, expectedOwnerUid, write);
        if (claim.kind === 'claimed') {
          tx.update(groupRef, {
            ownerUid: claim.ownerUid,
            memberUids: claim.memberUids,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        return claim;
      });
    },

    eraseMemberTraces: async (groupId, leavingUid, erasure) => {
      const groupRef = db.doc(`groups/${groupId}`);
      // WHICH writes and in WHAT ORDER is decided by memberTraceWrites, and HOW THEY ARE
      // SPLIT by chunkWrites — both pure, both in logic.ts, both reachable by a test that
      // needs no firebase-admin. BIN-1109: this used to be an inline accumulate-and-flush
      // loop, and no test reached it. Every test port implemented the method as one
      // unbroken batch, so `flush()` never ran anywhere and the split's own correctness —
      // that nothing is dropped at a chunk boundary, that the counter resets — was
      // asserted by nothing. This port now only EXECUTES.
      //
      // The deletes are no-ops on a document that is already gone, so a retry converges.
      // The field removals are `update` and DO throw if the row was deleted meanwhile —
      // that fails this group, which the caller counts and reports rather than swallowing.
      // A merging `set` would be worse: on a deleted row it would resurrect a ghost
      // carrying nothing but a tombstone.
      for (const chunk of chunkWrites(memberTraceWrites(leavingUid, erasure), BATCH_LIMIT)) {
        const batch = db.batch();
        for (const w of chunk) {
          const ref = groupRef.collection(w.collection).doc(w.doc);
          if (w.op === 'delete') batch.delete(ref);
          else if (w.op === 'clear') batch.update(ref, { [w.field as string]: FieldValue.delete() });
          else batch.update(ref, { [w.field as string]: FieldValue.arrayRemove(leavingUid) });
        }
        await batch.commit();
      }
    },
  };
}

/**
 * BIN-1260 + BIN-1278: the two ports the leaver's erasure and the account-delete
 * door's member-group step need, built on the same reads as `adminHandoverIo`.
 */
export function adminLeaverIo(db: Firestore, log: HandoverIo['log']): LeaverIo & MemberGroupsIo & MemberStripIo {
  const base = adminHandoverIo(db, log);
  return {
    log,
    readGroup: base.readGroup,
    readWatchlist: base.readWatchlist,
    readSessionHistory: base.readSessionHistory,

    memberGroups: async (uid) => {
      const snap = await db.collection('groups').where('memberUids', 'array-contains', uid).select('ownerUid').get();
      return snap.docs.map((d) => ({ id: d.id, ownerUid: (d.get('ownerUid') as string | undefined) ?? '' }));
    },

    // BIN-1294: `update`, not a merge — it throws on a group that is gone rather than
    // resurrecting one holding nothing but a member list.
    stripMemberUid: async (groupId, uid) => {
      await db.doc('groups/' + groupId).update({ memberUids: FieldValue.arrayRemove(uid) });
    },

    eraseLeaverTraces: async (groupId, uid, erasure, requiredOwner) => {
      const groupRef = db.doc(`groups/${groupId}`);
      for (const chunk of chunkWrites(memberTraceWrites(uid, erasure), BATCH_LIMIT)) {
        // The group read and the chunk's writes are one transaction: see
        // `leaverChunkMayCommit` for the rejoin (and, BIN-1296, the ownership
        // change) it guards against.
        const wrote = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(groupRef);
          const group = fresh.exists
            ? {
                memberUids: (fresh.get('memberUids') as string[] | undefined) ?? [],
                ownerUid: (fresh.get('ownerUid') as string | undefined) ?? '',
              }
            : null;
          if (!leaverChunkMayCommit(group, uid, requiredOwner)) return false;
          for (const w of chunk) {
            const ref = groupRef.collection(w.collection).doc(w.doc);
            if (w.op === 'delete') tx.delete(ref);
            else if (w.op === 'clear') tx.update(ref, { [w.field as string]: FieldValue.delete() });
            else tx.update(ref, { [w.field as string]: FieldValue.arrayRemove(uid) });
          }
          return true;
        });
        if (!wrote) return { kind: 'stopped' };
      }
      return { kind: 'done' };
    },
  };
}
