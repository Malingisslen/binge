/**
 * onSessionInviteCreate — Bjud in till Tillsammans.
 *
 * Fires on `users/{recipientUid}/sessionInvites/{inviteId}`, which the host writes
 * client-side (`sendSessionInvites` in src/lib/firebase/sessionInvites.ts) after
 * the session exists. firestore.rules decides who may invite whom; this trigger
 * decides only whether the recipient hears about it.
 *
 * The session id is the session's access key, and `inviteId` and the document
 * carry it. Neither is logged, and neither goes into the card or the push.
 *
 * Decisions live in ./logic.ts. This file only reads, deletes an invite past the
 * recipient cap, runs the marker transaction and writes the notice.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { sendPushToUser } from '../push';
import { createInboxCard } from '../shared/inboxCard';
import {
  buildSessionInviteNotice,
  inviteIdNamesSender,
  mayNotifySessionInvite,
  overRecipientCap,
  recipientPushEnabled,
  sessionInvitePushMarkerId,
  wantsSessionInvites,
} from './logic';

// Duck-typed rather than `instanceof`: the Timestamp class a transaction returns
// need not be the same class object as ours.
function millis(value: unknown): number | null {
  const toMillis = (value as { toMillis?: unknown } | null | undefined)?.toMillis;
  return typeof toMillis === 'function' ? (toMillis.call(value) as number) : null;
}

export const onSessionInviteCreate = onDocumentCreated(
  'users/{recipientUid}/sessionInvites/{inviteId}',
  async (event) => {
    const snap = event.data;
    const data = snap?.data();
    if (!snap || !data) return;
    const { recipientUid, inviteId } = event.params;
    const fromUid = data.fromUid;
    if (!inviteIdNamesSender(inviteId, fromUid)) {
      logger.warn('onSessionInviteCreate: invite id does not name its sender', { recipientUid });
      return;
    }
    const db = getFirestore();
    const recipientRef = db.collection('users').doc(recipientUid);

    // Past the cap the new invite is deleted, not kept quietly: a recipient's list
    // must stay readable, and the sender gets no signal either way.
    const pending = await recipientRef.collection('sessionInvites').count().get();
    if (overRecipientCap(pending.data().count)) {
      try {
        await snap.ref.delete();
      } catch (err) {
        // Only the error code: the message of a failed delete names the document
        // path, and the path carries the session id.
        logger.error('onSessionInviteCreate: deleting an invite over the cap failed', {
          recipientUid, fromUid, code: (err as { code?: unknown })?.code ?? null,
        });
        return;
      }
      logger.info('onSessionInviteCreate: over the recipient cap, invite deleted', { recipientUid, fromUid });
      return;
    }

    const [recipientSnap, senderSnap] = await db.getAll(recipientRef, db.collection('users').doc(fromUid));
    const recipientProfile = recipientSnap.exists ? (recipientSnap.data() ?? {}) : null;
    if (recipientProfile === null || !wantsSessionInvites(recipientProfile)) {
      logger.info('onSessionInviteCreate: no notice', { recipientUid, fromUid, reason: recipientProfile ? 'opted-out' : 'recipient-missing' });
      return;
    }

    // Read and stamped in one transaction, so two invites landing at once cannot
    // both slip under the window. Stamped BEFORE the notice: a notice that then
    // fails still holds the window, the cheap direction for a brake against spam.
    const markerRef = db.collection('sessionInvitePushes').doc(sessionInvitePushMarkerId(recipientUid, fromUid));
    const mayNotify = await db.runTransaction(async (tx) => {
      const nowMs = Date.now();
      const last = millis((await tx.get(markerRef)).get('lastPushedAt'));
      if (!mayNotifySessionInvite(last, nowMs)) return false;
      tx.set(markerRef, { recipientUid, fromUid, lastPushedAt: Timestamp.fromMillis(nowMs) });
      return true;
    });
    if (!mayNotify) {
      logger.info('onSessionInviteCreate: notice held back, same pair notified within the window', { recipientUid, fromUid });
      return;
    }

    const notice = buildSessionInviteNotice(senderSnap.exists ? (senderSnap.data() ?? {}) : null);

    // The marker is the load-bearing write; the card and the push after it are
    // best-effort and fail on their own, so one going wrong never stops the other.
    const [card, push] = await Promise.allSettled([
      // Keyed on the event id: a redelivered event finds the card and leaves it.
      createInboxCard(db, recipientUid, `session-invite-${event.id}`, {
        ...notice.card,
        kind: 'session_invite',
      }),
      sendPushToUser(recipientUid, notice.push, { pushEnabled: recipientPushEnabled(recipientProfile) }),
    ]);
    if (card.status === 'rejected') {
      logger.error('onSessionInviteCreate: inbox card failed', { recipientUid, fromUid, err: card.reason });
    }
    if (push.status === 'rejected') {
      logger.error('onSessionInviteCreate: push failed', { recipientUid, fromUid, err: push.reason });
    }
  },
);
