/**
 * Callable group handover (BIN-1063 steg 3).
 *
 * Malin's decision of 2026-09-06: a group whose owner leaves is handed to the
 * longest-standing remaining member, never deleted, and that holds for both doors
 * — this callable, which the account-delete button calls before its cascade, and
 * the retention sweep. Both drive the same `runGroupHandover` through the one
 * Admin-SDK port in `adminIo.ts`.
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
 * intended. For the HANDOVER that is self-only and strictly weaker than the
 * `allow delete` an owner already holds on their own group. It does remove the
 * caller from the groups it hands over, and the rules forbid an owner adding a uid
 * back to `memberUids`, so getting back in needs a fresh invite.
 *
 * BIN-1147: it also erases the invitations the caller SENT, and that half is NOT
 * covered by the sentence above — #4's binding condition was that the old
 * justification must not be inherited. `allow delete` on
 * `users/{uid}/groupInvites/{groupId}` is the recipient OR the CURRENT group
 * owner, so once ownership has moved the original sender no longer qualifies.
 * Reaching this callable therefore grants a past inviter a cancel right the rules
 * withhold. Accepted, and narrow: `fromUid` is pinned on create and immutable, so
 * the query can only ever match invitations the caller really sent; the effect on
 * the recipient is a stale pending invite disappearing, never a loss of their own
 * data. The motivation is Art. 17 over the sender's own name, which the invitation
 * carries because the rules require it bound to a real profile.
 *
 * The erasure runs FIRST. A refusal from it is a run that wrote nothing, which is
 * what keeps the caller's "nothing has been deleted" wording true.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { HandoverRefusal, refusalAfterHandover, refusalForHandover } from './logic';
import {
  eraseSentInvites, runGroupHandover, runLeaverErasure, runMemberGroupErasure, runOwnerPickedHandover, runOwnerRemovalErasure,
} from './runHandover';
import { adminHandoverIo, adminHandoverNotifyIo, adminLeaverIo } from './adminIo';
import { adminReminderMarkerIo, eraseReminderMarkers } from '../rotationReminder/markers';



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

    const io = adminHandoverIo(getFirestore(), logger);

    // Before the handover, deliberately: see the header. `eraseSentInvites`
    // throws its own refusal, which carries no partial marker because nothing
    // has been written when it fires.
    let invites: { found: number };
    try {
      invites = await eraseSentInvites(io, uid);
    } catch (err) {
      throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
    }

    // BIN-1304: the owned-groups query runs outside the loop's per-group catch, so a
    // throw there skips `refusalForHandover`. By then the invitations may be gone,
    // and the client must not be told that nothing was deleted.
    let summary: Awaited<ReturnType<typeof runGroupHandover>>;
    try {
      summary = await runGroupHandover(io, uid);
    } catch (err) {
      logger.error('handOverOwnedGroups: handover threw', { err });
      throw new HttpsError('internal', refusalAfterHandover(invites.found > 0));
    }

    // A per-group failure is counted rather than thrown, so the rest of the
    // groups still get handed over. But the CALLER must not fall through: its
    // next step deletes what it still owns, and a group that failed here is a
    // group other people are still in. The predicate lives in `logic.ts` so a
    // test can call it.
    const refusal = refusalForHandover(summary, invites.found > 0);
    if (refusal) {
      throw new HttpsError('internal', refusal);
    }

    // BIN-1278 and BIN-1279: what the client cascade cannot reach. AFTER the
    // handover, so a group just handed over is no longer found by the member
    // query — the uid left its `memberUids` in the swap. A failure here comes
    // after writes may have landed, so whether it says "partial" is decided on
    // what was attempted, invites and handover included.
    const progress = { attempted: invites.found > 0 || summary.attempted > 0 };
    try {
      await runMemberGroupErasure({ ...io, ...adminLeaverIo(getFirestore(), logger) }, uid, progress);
      await eraseReminderMarkers(adminReminderMarkerIo(getFirestore()), uid, progress);
    } catch (err) {
      logger.error('handOverOwnedGroups: erasure after the handover failed', { err });
      throw new HttpsError('internal', refusalAfterHandover(progress.attempted));
    }
    return summary;
  },
);

/**
 * BIN-1118: hand ONE group to a successor the owner named, and leave it.
 *
 * A second entry point beside `handOverOwnedGroups`, not a parameter on it. The
 * two answer different questions: that one is "this account is going away, place
 * every group it owns", driven by the deletion cascade and the retention sweep,
 * with no human present to choose. This one is "I picked Jonas", driven by a
 * button, about a single group, and it must REFUSE rather than quietly do nothing
 * when the pick is wrong — the person is looking at the result.
 *
 * It is a callable for the same reason the other one is: `ownerUid` is pinned
 * unchanged on every client-writable `groups/{groupId}` update branch, and it
 * stays pinned. Derive that rather than trusting this sentence:
 *   grep -n "resource.data.ownerUid" firestore.rules
 *
 * A rules branch could have expressed the membership check on its own — the
 * successor must be in `memberUids`, which needs no `get()` and no iteration, so
 * this is NOT the case the 2026-09-07 deviation entry turned down. Two other
 * things decided it. The remaining members are notified, and that writes into
 * OTHER people's `users/{uid}/notifications` trees, which no rules branch can
 * permit. And the departing owner's own traces must be erased by the same
 * machinery the deletion door uses, which lives here.
 *
 * `leavingUid` is the authenticated caller and is never read from the payload:
 * you can only hand over a group you own.
 */
export const handOverGroup = onCall(
  { region: 'europe-west1', timeoutSeconds: 300 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Du måste vara inloggad.');

    const data = request.data as { groupId?: unknown; successorUid?: unknown } | null;
    const groupId = typeof data?.groupId === 'string' ? data.groupId : '';
    const successorUid = typeof data?.successorUid === 'string' ? data.successorUid : '';
    if (!groupId || !successorUid) {
      throw new HttpsError('invalid-argument', 'Grupp och efterträdare måste anges.');
    }

    const db = getFirestore();
    const io = { ...adminHandoverIo(db, logger), ...adminHandoverNotifyIo(db) };

    try {
      await runOwnerPickedHandover(io, groupId, uid, successorUid);
    } catch (err) {
      // Only a refusal carries wording written for the owner to read, and only a
      // refusal gets the code the client passes through verbatim. Everything else
      // — a failed batch write, an unreachable document — is `internal`, whose
      // message the client replaces with a Swedish sentence.
      //
      // Marking the difference at the THROW site rather than here is what keeps
      // it true: an earlier version assigned `failed-precondition` to everything
      // in this try, so a raw gRPC string reached the dialog.
      if (err instanceof HandoverRefusal) {
        throw new HttpsError('failed-precondition', err.message);
      }
      logger.error('handOverGroup: failed', { groupId, err });
      throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
    }
    return { ok: true };
  },
);

/**
 * BIN-1260: erase the caller's own traces from a group they have ALREADY left.
 *
 * Malin's decision of 2026-09-23: leaving a group should erase what the handover
 * erases for a departing owner. The leave itself stays a client write, and this
 * is a separate step the client calls after it (#12's condition, recorded under
 * `## BIN-1120` in .claude/rules/accepted-deviations.md). A failure here never
 * undoes or blocks the leave.
 *
 * Without `memberUid` (or with the caller's own uid): reachable by any signed-in
 * caller for any group id. Every write names the caller's own uid
 * (`memberTraceWrites`), so a caller who was never in the group changes nothing,
 * and the answer is the same `{ ok: true }` whether the group exists or not. The
 * refusals are about the caller's own membership only.
 *
 * BIN-1296: with a `memberUid` that is not the caller, the owner erases a member
 * they have removed. A caller who does not own the group gets the same silent
 * `{ ok: true }` as a missing group, and nothing is written. The one refusal is
 * that the named person is still a member, and only an owner can reach it.
 *
 * `internal` errors carry a fixed sentence rather than the raw error, so nothing
 * about the group reaches the caller (#4's condition).
 */
export const eraseMyGroupTraces = onCall(
  { region: 'europe-west1', timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Du måste vara inloggad.');

    const data = request.data as { groupId?: unknown; memberUid?: unknown } | null;
    const groupId = typeof data?.groupId === 'string' ? data.groupId : '';
    // A document id: no path separator, and Firestore's own length ceiling.
    if (!groupId || groupId.includes('/') || groupId.length > 1500) {
      throw new HttpsError('invalid-argument', 'Grupp måste anges.');
    }
    const memberUid = data?.memberUid;
    if (
      memberUid !== undefined
      && (typeof memberUid !== 'string' || !memberUid || memberUid.includes('/') || memberUid.length > 128)
    ) {
      throw new HttpsError('invalid-argument', 'Ogiltig medlem.');
    }

    try {
      const io = adminLeaverIo(getFirestore(), logger);
      if (memberUid === undefined || memberUid === uid) await runLeaverErasure(io, groupId, uid);
      else await runOwnerRemovalErasure(io, groupId, uid, memberUid);
    } catch (err) {
      if (err instanceof HandoverRefusal) {
        throw new HttpsError('failed-precondition', err.message);
      }
      logger.error('eraseMyGroupTraces: failed', { groupId, err });
      throw new HttpsError('internal', 'Kunde inte radera dina spår i gruppen.');
    }
    return { ok: true };
  },
);
