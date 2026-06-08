/**
 * Shared FCM sender for Binge Cloud Functions.
 *
 * Lifted verbatim from index.ts so both the existing Firestore triggers and the
 * scheduled episode-release function use one sender. Handles:
 * - Hämtning av users/{uid}/fcmTokens
 * - notificationSettings.pushEnabled-gating per mottagare (defensiv —
 *   klienten ska redan ha hindrat skapandet, men dubbel-check)
 * - Invalid-token-cleanup när FCM returnerar 'messaging/registration-
 *   token-not-registered' (token har raderats av webbläsare/användare)
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions/v2';

interface FcmTokenDoc {
  token: string;
  createdAt?: FirebaseFirestore.Timestamp;
  lastUsedAt?: FirebaseFirestore.Timestamp;
  userAgent?: string;
}

export interface NotifPayload {
  title: string;
  body: string;
  // URL relativ origin — service-worker hanterar klick → window.open(url).
  actionUrl: string;
  // Användbart i SW för att gruppera/ersätta tidigare notifs av samma typ.
  tag?: string;
}

/**
 * Skickar en push till alla tokens som tillhör recipientUid. Hämtar och
 * respekterar pushEnabled-flaggan. Rensar upp tokens som FCM rapporterar
 * som ogiltiga.
 */
export async function sendPushToUser(recipientUid: string, payload: NotifPayload): Promise<void> {
  const db = getFirestore();

  const profileSnap = await db.collection('users').doc(recipientUid).get();
  if (!profileSnap.exists) {
    logger.info(`[push] skipping ${recipientUid} — user-doc missing`);
    return;
  }
  const settings = profileSnap.data()?.notificationSettings as
    | { pushEnabled?: boolean }
    | undefined;
  if (!settings?.pushEnabled) {
    logger.info(`[push] skipping ${recipientUid} — pushEnabled=false`);
    return;
  }

  const tokensSnap = await db.collection('users').doc(recipientUid).collection('fcmTokens').get();
  if (tokensSnap.empty) {
    logger.info(`[push] no tokens registered for ${recipientUid}`);
    return;
  }

  const messaging = getMessaging();
  // sendEach skickar i parallell och returnerar per-token-status. Begränsat
  // till 500 messages/call — vi har max 10-tal tokens per användare så fine.
  const messages: Message[] = tokensSnap.docs.map(d => {
    const data = d.data() as FcmTokenDoc;
    return {
      token: data.token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      webpush: {
        fcmOptions: {
          // Klick på notif öppnar denna URL. Service-worker har en fallback
          // som hanterar relativa URLs mot origin.
          link: payload.actionUrl,
        },
        notification: {
          icon: '/og-image.svg',
          tag: payload.tag,
          renotify: payload.tag != null,
        },
      },
    };
  });

  const result = await messaging.sendEach(messages);
  logger.info(`[push] ${recipientUid}: success=${result.successCount} failure=${result.failureCount}`);

  // Rensa upp ogiltiga tokens. Två feltyper indikerar att tokenet inte
  // längre ska användas: registration-token-not-registered (raderad av
  // användaren / browser) och invalid-registration-token (korrupt).
  const cleanupOps: Promise<unknown>[] = [];
  result.responses.forEach((resp, idx) => {
    if (resp.success) {
      // Uppdatera lastUsedAt så vi kan rensa ovanvädrade tokens senare.
      cleanupOps.push(
        tokensSnap.docs[idx].ref.update({ lastUsedAt: FieldValue.serverTimestamp() }),
      );
      return;
    }
    const code = resp.error?.code ?? '';
    if (
      code === 'messaging/registration-token-not-registered'
      || code === 'messaging/invalid-registration-token'
    ) {
      logger.info(`[push] removing stale token for ${recipientUid}: ${code}`);
      cleanupOps.push(tokensSnap.docs[idx].ref.delete());
    } else {
      logger.warn(`[push] non-fatal send error for ${recipientUid}: ${code}`);
    }
  });
  await Promise.allSettled(cleanupOps);
}
