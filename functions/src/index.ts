/**
 * Cloud Functions för Binge — Fas 4: FCM push-notifs.
 *
 * Två firestore-triggers:
 *
 * 1. onFriendRequestCreate — när någon skickar en vänförfrågan, push:a
 *    mottagaren ("Anna vill bli vän").
 *
 * 2. onSessionPickCreate — när en gruppmedlem loggar pick:en från en
 *    Tillsammans-session, push:a alla andra medlemmar i gruppen
 *    ("Anna har valt 'Den nya filmen'").
 *
 * Delad sender-helper hanterar:
 * - Hämtning av users/{uid}/fcmTokens
 * - notificationSettings.pushEnabled-gating per mottagare (defensiv —
 *   klienten ska redan ha hindrat skapandet, men dubbel-check)
 * - Invalid-token-cleanup när FCM returnerar 'messaging/registration-
 *   token-not-registered' (token har raderats av webbläsare/användare)
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger, setGlobalOptions } from 'firebase-functions/v2';

initializeApp();

// europe-west1 (Belgien) — närmaste GCP-region till Sverige som stödjer
// alla tjänster. Lambda-cold-start blir ~150 ms mot ~250 ms från us-central1.
// Memory + timeout default räcker — vi gör bara FCM-skick + Firestore-läs.
setGlobalOptions({
  region: 'europe-west1',
  maxInstances: 10,
});

interface FcmTokenDoc {
  token: string;
  createdAt?: FirebaseFirestore.Timestamp;
  lastUsedAt?: FirebaseFirestore.Timestamp;
  userAgent?: string;
}

interface NotifPayload {
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
async function sendPushToUser(recipientUid: string, payload: NotifPayload): Promise<void> {
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

/**
 * Trigger 1: vänförfrågan skapad → push:a mottagaren.
 *
 * Path: users/{recipientUid}/friendRequests/{fromUid}
 * Payload-fält som finns på doc:et (skrivs av sendFriendRequest):
 *   - fromUid: string
 *   - fromDisplayName: string
 *   - fromUsername: string | null
 *   - sentAt: serverTimestamp
 */
export const onFriendRequestCreate = onDocumentCreated(
  'users/{recipientUid}/friendRequests/{fromUid}',
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const recipientUid = event.params.recipientUid;
    const fromDisplayName = (data.fromDisplayName as string) ?? 'Någon';
    const fromUsername = data.fromUsername as string | null;

    // Klick på notif → vännernas-sidan med pending-fliken aktiv.
    // /friends/?tab=requests fungerar i appen via search-param-läsare.
    const actionUrl = '/friends/?tab=requests';

    await sendPushToUser(recipientUid, {
      title: 'Ny vänförfrågan',
      body: fromUsername
        ? `${fromDisplayName} (@${fromUsername}) vill bli vän`
        : `${fromDisplayName} vill bli vän`,
      actionUrl,
      // Tag = avsändar-uid → om samma person skickar två requests (efter
      // decline + ny) ersätter den nya den gamla notifen istället för att
      // stapla. Mest defensiv — vi tillåter aldrig dubbla pending-requests
      // från samma avsändare.
      tag: `friend-request-${event.params.fromUid}`,
    });
  },
);

/**
 * Trigger 2: gruppen loggade en pick från Tillsammans-session → push:a
 * alla medlemmar utom skribenten.
 *
 * Path: groups/{groupId}/sessionHistory/{sessionId}
 * Payload-fält (skrivs av recordGroupSessionPick):
 *   - sessionId: string
 *   - tmdbId: number
 *   - mediaType: 'movie' | 'tv'
 *   - title: string
 *   - posterPath: string | null
 *   - pickedByUid: string
 *   - pickedByName: string
 *   - pickedAt: serverTimestamp
 */
export const onSessionPickCreate = onDocumentCreated(
  'groups/{groupId}/sessionHistory/{sessionId}',
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const groupId = event.params.groupId;
    const pickedByUid = data.pickedByUid as string;
    const pickedByName = (data.pickedByName as string) ?? 'Någon';
    const title = (data.title as string) ?? 'en titel';

    const db = getFirestore();
    const groupSnap = await db.collection('groups').doc(groupId).get();
    if (!groupSnap.exists) {
      logger.warn(`[push] sessionHistory created on missing group ${groupId}`);
      return;
    }
    const memberUids = (groupSnap.data()?.memberUids as string[]) ?? [];
    const groupName = (groupSnap.data()?.name as string) ?? 'din grupp';

    // Skriv-personen vill inte få sin egen notif. Övriga medlemmar push:as.
    const recipients = memberUids.filter(u => u !== pickedByUid);
    if (recipients.length === 0) {
      logger.info(`[push] no recipients for sessionPick in ${groupId}`);
      return;
    }

    const actionUrl = `/grupper/${groupId}/`;
    const body = `${pickedByName} har valt "${title}"`;

    await Promise.allSettled(
      recipients.map(uid =>
        sendPushToUser(uid, {
          title: `Filmkväll i ${groupName}`,
          body,
          actionUrl,
          // Tag per (group, session) så samma session inte kan stapla
          // notifs (replay-safety vid re-run av function).
          tag: `session-pick-${groupId}-${event.params.sessionId}`,
        }).catch(err => {
          logger.error(`[push] failed for ${uid}`, err);
        }),
      ),
    );
  },
);
