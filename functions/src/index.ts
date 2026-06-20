/**
 * Cloud Functions för Binge — Fas 4: FCM push-notifs.
 * Runtime: Node 22 — styrs av firebase.json functions.runtime (inte engines).
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
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { sendPushToUser } from './push';

initializeApp();

// europe-west1 (Belgien) — närmaste GCP-region till Sverige som stödjer
// alla tjänster. Lambda-cold-start blir ~150 ms mot ~250 ms från us-central1.
// Memory + timeout default räcker — vi gör bara FCM-skick + Firestore-läs.
setGlobalOptions({
  region: 'europe-west1',
  maxInstances: 10,
});

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
 * Payload-fält (skrivs av recordGroupSessionPick i src/lib/firebase/groups.ts):
 *   - sessionId: string
 *   - pickedByUid: string   (uid för den som valde; == skrivaren, enforced i rules)
 *   - pickedTmdbId: number
 *   - mediaType: 'movie' | 'tv'
 *   - mediaTitle: string
 *   - posterPath: string | null
 *   - participantUids: string[]
 *   - pickedAt: serverTimestamp
 *
 * Skribenten (pickedByUid) får ingen egen push. Hens namn slås upp
 * auktoritativt från users/{pickedByUid}.displayName — vi litar inte på
 * något denormaliserat/förfalskbart namnfält i pick-dokumentet.
 */
export const onSessionPickCreate = onDocumentCreated(
  'groups/{groupId}/sessionHistory/{sessionId}',
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const groupId = event.params.groupId;
    const mediaTitle = (data.mediaTitle as string) ?? 'en titel';
    // Explicit, regel-verifierad picker-uid (== skrivaren). Faller tillbaka
    // på null för ev. äldre dokument utan fältet.
    const pickedByUid = (data.pickedByUid as string) ?? null;

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

    // Slå upp skribentens namn auktoritativt (ej förfalskbart denormaliserat
    // fält). Faller tillbaka på "Någon" om profilen saknar displayName eller
    // pickedByUid saknas (äldre dokument).
    let pickerName = 'Någon';
    if (pickedByUid) {
      const userSnap = await db.collection('users').doc(pickedByUid).get();
      pickerName = (userSnap.data()?.displayName as string) || 'Någon';
    }

    const actionUrl = `/grupper/${groupId}/`;
    const body = `${pickerName} valde "${mediaTitle}"`;

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

// ── Insikter (intern analys-dashboard) ───────────────────────────────────────
// rollupInsights: schemalagd Firestore-aggregering → insights/daily.
// apiInsights: HTTP-endpoint bakom /api/insights (admin-token + Plausible-merge).
export { rollupInsights } from './insights/rollup';
export { apiInsights } from './insights/api';

// ── Episod-release-push (B4) ──────────────────────────────────────────────────
// episodeReleaseNotify: schemalagd collectionGroup-scan → push:ar followers som
// är ikapp på en serie när TMDB rapporterar ett nytt aireat avsnitt.
export { episodeReleaseNotify } from './episodeNotify';

// ── Orphan-follow-sweep (BIN-21 storage-backstop) ────────────────────────────
// reclaimOrphanFollows: veckovis collectionGroup-scan → raderar following/
// followers-docs som pekar på ett raderat konto (inbound-follows som
// deleteAccount inte får röra, ägda av följaren per firestore.rules).
export { reclaimOrphanFollows } from './reclaimOrphanFollows';

// ── Retention cleanup (BIN-65) ───────────────────────────────────────────────
// retentionCleanup: daglig scan → raderar utgångna Tillsammans-sessioner (past
// expiresAt, recursiveDelete inkl. participants/swipes) + notiser >90 dagar.
// Trösklar från docs/data-retention-policy.md. Bounded/paginerad (BIN-50-mönster).
export { retentionCleanup } from './retentionCleanup';

// ── Report submit (BIN-49) ───────────────────────────────────────────────────
// submitReport: callable som ersätter klient-writeBatch + rules-throttle (BIN-25,
// som gick att kringgå per batch). Server-auktoritativ cooldown i transaktion;
// reports-create-regeln är låst till `if false` så bara denna funktion får skapa.
export { submitReport } from './submitReport';

// ── External ratings (OMDb) ──────────────────────────────────────────────────
// titleRatings: callable med 45-dagars delad Firestore-cache per IMDb-id.
// Hämtar IMDb-score, Rotten Tomatoes och Metacritic från OMDb API.
export { titleRatings } from './titleRatings';
