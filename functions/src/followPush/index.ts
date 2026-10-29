/**
 * onFollowCreate — "{namn} följer dig nu" when someone starts following you.
 *
 * Fires on `users/{recipientUid}/followers/{followerUid}`, which `followUser`
 * writes client-side in the same batch as the follower's own `following` doc.
 * The follower is the document id, which firestore.rules binds to the writer;
 * no field in the document is trusted for who followed or what they are called.
 *
 * Decisions live in ./logic.ts. This file only reads, runs the marker
 * transaction and writes the notice.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { sendPushToUser } from '../push';
import {
  buildFollowNotice,
  followNoticeSkipReason,
  followPushPairId,
  followPushRateId,
  followerVisibleTo,
  gateFollowNotice,
  recipientPushEnabled,
  type FollowGate,
} from './logic';

// Duck-typed rather than `instanceof`: the event payload's Timestamp class is
// decoded by firebase-functions and need not be the same class object as ours.
function millis(value: unknown): number | null {
  const toMillis = (value as { toMillis?: unknown } | null | undefined)?.toMillis;
  return typeof toMillis === 'function' ? (toMillis.call(value) as number) : null;
}

export const onFollowCreate = onDocumentCreated(
  'users/{recipientUid}/followers/{followerUid}',
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const { recipientUid, followerUid } = event.params;
    const db = getFirestore();

    // One round trip for the four reads every decision below needs.
    const [recipientSnap, blockedSnap, followerSnap, friendSnap] = await db.getAll(
      db.collection('users').doc(recipientUid),
      db.collection('users').doc(recipientUid).collection('blocked').doc(followerUid),
      db.collection('users').doc(followerUid),
      db.collection('users').doc(followerUid).collection('friends').doc(recipientUid),
    );
    const recipientProfile = recipientSnap.exists ? (recipientSnap.data() ?? {}) : null;
    const followerProfile = followerSnap.exists ? (followerSnap.data() ?? {}) : null;

    const skip = followNoticeSkipReason({
      recipientUid,
      followerUid,
      followedAtMs: millis(data.followedAt),
      recipientProfile,
      recipientBlockedFollower: blockedSnap.exists,
      followerProfile,
      nowMs: Date.now(),
    });
    if (skip !== null || recipientProfile === null || followerProfile === null) {
      logger.info('onFollowCreate: no notice', { recipientUid, followerUid, reason: skip });
      return;
    }

    // Both markers are read and stamped in one transaction, so two follows landing
    // at once cannot both slip under the pair window or the hourly cap. They are
    // stamped BEFORE the notice: a notice that then fails still holds the window,
    // which is the cheap direction for a brake against notice spam.
    const pairRef = db.collection('followPushes').doc(followPushPairId(recipientUid, followerUid));
    const rateRef = db.collection('followPushes').doc(followPushRateId(recipientUid));
    const gate: FollowGate = await db.runTransaction(async (tx) => {
      const [pairSnap, rateSnap] = await tx.getAll(pairRef, rateRef);
      const count = rateSnap.get('count');
      const decision = gateFollowNotice({
        pairLastPushedAtMs: millis(pairSnap.get('lastPushedAt')),
        rateWindowStartedAtMs: millis(rateSnap.get('windowStartedAt')),
        rateCount: typeof count === 'number' ? count : 0,
      }, Date.now());
      if (decision.send) {
        tx.set(pairRef, { lastPushedAt: Timestamp.fromMillis(decision.pair.lastPushedAtMs) });
        tx.set(rateRef, {
          windowStartedAt: Timestamp.fromMillis(decision.rate.windowStartedAtMs),
          count: decision.rate.count,
          lastPushedAt: Timestamp.fromMillis(decision.rate.lastPushedAtMs),
        });
      }
      return decision;
    });
    if (!gate.send) {
      logger.info('onFollowCreate: notice held back', { recipientUid, followerUid, reason: gate.reason });
      return;
    }

    const notice = buildFollowNotice(followerProfile, followerVisibleTo(followerProfile, friendSnap.exists));

    // The markers are the load-bearing write; the card and the push after them are
    // best-effort and fail on their own, so one going wrong never stops the other.
    const [card, push] = await Promise.allSettled([
      // Keyed on the event id with create(): a redelivered event finds the card and
      // leaves it, rather than adding a second one or marking a read one unread.
      db.collection('users').doc(recipientUid).collection('notifications')
        .doc(`follow-${event.id}`)
        .create({
          kind: 'system',
          title: notice.title,
          body: notice.body,
          actionUrl: notice.actionUrl,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        }),
      sendPushToUser(recipientUid, {
        title: notice.title,
        body: notice.body,
        actionUrl: notice.actionUrl,
        // Per follower, so a second notice from the same person replaces the first.
        tag: `follow-${followerUid}`,
      }, { pushEnabled: recipientPushEnabled(recipientProfile) }),
    ]);
    if (card.status === 'rejected' && (card.reason as { code?: unknown })?.code !== 6) {
      logger.error('onFollowCreate: inbox card failed', { recipientUid, followerUid, err: card.reason });
    }
    if (push.status === 'rejected') {
      logger.error('onFollowCreate: push failed', { recipientUid, followerUid, err: push.reason });
    }
  },
);
