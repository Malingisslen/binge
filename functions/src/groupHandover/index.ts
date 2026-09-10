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

import { refusalForHandover } from './logic';
import { eraseSentInvites, runGroupHandover } from './runHandover';
import { adminHandoverIo } from './adminIo';



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
    try {
      await eraseSentInvites(io, uid);
    } catch (err) {
      throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
    }

    const summary = await runGroupHandover(io, uid);

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
