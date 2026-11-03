/**
 * Bjud in till Tillsammans: erase what an account leaves behind in OTHER people's
 * reach when it is deleted.
 *
 * - `users/{other}/sessionInvites/{sessionId}_{uid}`, the invites the account SENT.
 *   They carry its name and lie in the recipient's tree, whose read rule is
 *   `isOwner`, so no client query can find them. Same reasoning as the sent group
 *   invites `eraseSentInvites` erases.
 * - `sessionInvitePushes/*` whose `recipientUid` or `fromUid` is the account: the
 *   notice brake. Clients may read their own but write none. A marker that names
 *   the account only as SENDER is erased only once it no longer holds a notice back
 *   (`mayEraseSessionInviteMarker`): any signed-in user can call `handOverOwnedGroups`
 *   without deleting their account, and erasing a live sender marker would let them
 *   invite, call it, and invite again with a fresh notice each time. A younger one
 *   is left for the retention sweep.
 *
 * The sent invites are erased whatever their age. That lets a caller re-invite the
 * same person to the same session, but the new invite's notice still meets the
 * sender marker kept above. The recipient cap counts the pending invites a
 * recipient holds from every host, so erasing the caller's own invites frees only
 * slots the caller held, and leaves other hosts' invites where they were. Keeping
 * them instead would leave the deleted account's name in other people's trees.
 *
 * The account-delete button reaches this through `handOverOwnedGroups`. For an
 * account deleted from the Firebase Console the retention sweep is the backstop:
 * invites go after `SESSION_INVITE_MAX_AGE_MS` and markers after
 * `SESSION_INVITE_PUSH_MARKER_MAX_AGE_MS`, both in functions/src/sessionInvitePush/logic.ts.
 *
 * Its own port rather than more methods on `HandoverIo`: the invites have nothing
 * to do with groups, and the test ports that implement `HandoverIo` need not grow.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { mayNotifySessionInvite } from '../sessionInvitePush/logic';

/** Writes per batch, under Firestore's own 500 ceiling. */
const SESSION_INVITE_BATCH_LIMIT = 450;

export interface SessionInviteMarker {
  path: string;
  recipientUid: unknown;
  /** `lastPushedAt` in milliseconds, or null when the field is missing or not a timestamp. */
  lastPushedAtMs: number | null;
}

/**
 * Whether erasing the uid's traces may delete this marker. One naming the uid as
 * recipient only brakes notices TO the uid, so it goes. One naming the uid only as
 * sender goes when the trigger would let a new notice through anyway, read with the
 * trigger's own `mayNotifySessionInvite`.
 */
export function mayEraseSessionInviteMarker(marker: SessionInviteMarker, uid: string, nowMs: number): boolean {
  return marker.recipientUid === uid || mayNotifySessionInvite(marker.lastPushedAtMs, nowMs);
}

export interface SessionInviteErasureIo {
  /** Paths of every `users/{other}/sessionInvites/*` whose `fromUid` is the uid. */
  sentInvitePaths(uid: string): Promise<readonly string[]>;
  /** Every `sessionInvitePushes/*` naming the uid as recipient or sender. */
  markers(uid: string): Promise<readonly SessionInviteMarker[]>;
  /** Delete the given paths in one batch. */
  deletePaths(paths: readonly string[]): Promise<void>;
}

/**
 * Delete the sent invites and the markers, in batches.
 *
 * `progress.attempted` is set before the first batch, as in `eraseReminderMarkers`:
 * a throw after a batch has landed must not be reported as a run that wrote
 * nothing. Every write is a delete, so a retry converges.
 */
export async function eraseSessionInviteTraces(
  io: SessionInviteErasureIo,
  uid: string,
  progress: { attempted: boolean },
  nowMs: number = Date.now(),
): Promise<{ found: number }> {
  const [invites, markers] = await Promise.all([io.sentInvitePaths(uid), io.markers(uid)]);
  const erasable = markers.filter((m) => mayEraseSessionInviteMarker(m, uid, nowMs)).map((m) => m.path);
  const paths = [...new Set([...invites, ...erasable])];
  for (let i = 0; i < paths.length; i += SESSION_INVITE_BATCH_LIMIT) {
    progress.attempted = true;
    await io.deletePaths(paths.slice(i, i + SESSION_INVITE_BATCH_LIMIT));
  }
  return { found: paths.length };
}

// Duck-typed, as in onSessionInviteCreate: a Timestamp from the Admin SDK need not
// be the same class object as one imported here.
function millis(value: unknown): number | null {
  const toMillis = (value as { toMillis?: unknown } | null | undefined)?.toMillis;
  return typeof toMillis === 'function' ? (toMillis.call(value) as number) : null;
}

export function adminSessionInviteErasureIo(db: Firestore): SessionInviteErasureIo {
  return {
    sentInvitePaths: async (uid) => {
      const snap = await db.collectionGroup('sessionInvites').where('fromUid', '==', uid).select().get();
      return snap.docs.map((d) => d.ref.path);
    },
    markers: async (uid) => {
      const [received, sent] = await Promise.all([
        db.collection('sessionInvitePushes').where('recipientUid', '==', uid).select('recipientUid', 'lastPushedAt').get(),
        db.collection('sessionInvitePushes').where('fromUid', '==', uid).select('recipientUid', 'lastPushedAt').get(),
      ]);
      return [...received.docs, ...sent.docs].map((d) => ({
        path: d.ref.path,
        recipientUid: d.get('recipientUid'),
        lastPushedAtMs: millis(d.get('lastPushedAt')),
      }));
    },
    deletePaths: async (paths) => {
      const batch = db.batch();
      paths.forEach((p) => batch.delete(db.doc(p)));
      await batch.commit();
    },
  };
}
