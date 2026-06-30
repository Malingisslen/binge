import type { DocumentSnapshot, QuerySnapshot } from 'firebase/firestore';
import { fsdb } from './db';

/**
 * Gemensam läsning av allt som tillhör en användare — används av både
 * data-export (`buildUserExport`) och kontoradering (`deleteAccount`).
 *
 * Två konsumenter delar uppsättning → queryuppsättningen måste hållas i
 * sync med `firestore.indexes.json`. Om en ny subcollection läggs till
 * under `users/{uid}/` är detta den enda platsen att uppdatera.
 *
 * Anmärkning: per-review-followups (likes/comments på MINA reviews) och
 * per-group-followups (members/watchlist för grupper jag äger) är INTE
 * med här — de gör vi bara vid radering och kräver snapshots vi redan
 * har. Den här helpern hämtar bara "top-level"-datan.
 *
 * BIN-329: `groups/{id}/joinAttempts/{myUid}` hör också till radering-bara-
 * klassen — det raderas inline i `deleteAccount`s grupp-loop (per grupp jag är
 * medlem i) och sopas dessutom av den schemalagda `retentionCleanup`-sweepen
 * (orphans + Console-raderade konton). Det är medvetet INTE en `UserDataSnapshots`-
 * nyckel och UNDANTAGET ur exporten: payloaden är gruppens delade invite-token
 * (en hemlighet), inte användarens egna personuppgifter — samma resonemang som
 * `fcmTokens`. Lägg därför inte till det här.
 */
export interface UserDataSnapshots {
  profileSnap: DocumentSnapshot;
  watchlistSnap: QuerySnapshot;
  episodeProgressSnap: QuerySnapshot;
  notInterestedSnap: QuerySnapshot;
  notificationsSnap: QuerySnapshot;
  blockedSnap: QuerySnapshot;
  followingSnap: QuerySnapshot;
  // Inkommande följare (spegel-subcollection). Med i export (GDPR Art. 20 —
  // social graf åt båda håll). Raderas INTE här: varje doc ägs av följaren
  // (rules: isOwner(followerUid)), så kontoinnehavaren kan inte radera dem;
  // dangling-referenser filtreras lazy på läsning (useFollowList) istället.
  followersSnap: QuerySnapshot;
  friendsSnap: QuerySnapshot;
  friendRequestsSnap: QuerySnapshot;
  friendRequestsSentSnap: QuerySnapshot;
  // Inkomna grupp-inbjudningar (samtyckesflöde). Inkluderas i export +
  // delete-cascade så ingen pending inbjudan blir kvar efter radering.
  groupInvitesSnap: QuerySnapshot;
  // FCM web-push tokens (Fas 4). Inkluderas i delete-cascade. För export
  // behöver vi inte exponera tokens (de är device-specifika och meningslösa
  // utanför Firebase) — buildUserExport kan hoppa över detta fält.
  fcmTokensSnap: QuerySnapshot;
  // Report-throttle-stämpel (BIN-25). Operationell metadata — med i delete-
  // cascade så den inte orphan:as, men hoppas över i export (som fcmTokens).
  reportMetaSnap: QuerySnapshot;
  // Fråga Binge LLM-fallback rate-limit throttle. Operationell metadata — med i
  // delete-cascade så den inte orphan:as, hoppas över i export (som reportMeta).
  askBingeMetaSnap: QuerySnapshot;
  // Sparbeslut-historik (Streamingrådgivaren) — skrivs av resumeProvider.
  // Inkluderas i export + delete-cascade.
  pauseHistorySnap: QuerySnapshot;
  // Följda listor (BIN-96). Ägar-ägd subcollection → med i export + delete-
  // cascade (annars orphan:as den efter radering).
  listFollowsSnap: QuerySnapshot;
  reviewsSnap: QuerySnapshot;
  reviewLikesSnap: QuerySnapshot;
  reviewCommentsSnap: QuerySnapshot;
  // Mina avsnitts-reaktioner (BIN-95, collectionGroup 'reactions' where uid==me).
  // I export + delete-cascade (mina UGC, som reviewComments).
  episodeReactionsSnap: QuerySnapshot;
  listsSnap: QuerySnapshot;
  // Lists I co-edit (BIN-100, editors array-contains me). In export (my
  // editorship is my data). On account deletion (BIN-149) the cascade strips my
  // uid from each list's editors[] — the list doc itself is owned by someone
  // else and is NOT deleted, but I no longer linger as a ghost co-editor.
  editableListsSnap: QuerySnapshot;
  sessionsSnap: QuerySnapshot;
  groupsSnap: QuerySnapshot;
}

/**
 * The owner-owned `users/{uid}/<name>` subcollections this helper reads — the
 * single source of truth for the GDPR subcollection-enumeration guard
 * (`userData.subcollections.test.ts`, BIN-347).
 *
 * The guard asserts this list is set-EQUAL to the `users/{uid}/*` paths
 * declared in `firestore.rules` AND to the `collection(db, 'users', uid, …)`
 * reads below. That closes the BIN-277/joinAttempts *whole-collection-miss*:
 * a new `users/{uid}/<x>` collection added to rules but never wired into this
 * helper never becomes a `keyof UserDataSnapshots`, so the compile-time
 * coverage gate (`dataExport.coverage.test.ts`) can't see it — but the rules↔
 * list equality check goes red. Keeping the list HERE (next to the reads it
 * mirrors) means it can't drift into a third hand-maintained mirror.
 *
 * Known, deliberately-NOT-closed gap: a subcollection created only via the
 * Firebase Console (never declared in rules) is invisible to both checks; the
 * scheduled `retentionCleanup` sweep is the reaper-owned backstop for that.
 */
export const KNOWN_USER_SUBCOLLECTIONS = [
  'watchlist',
  'episodeProgress',
  'notInterested',
  'pauseHistory',
  'blocked',
  'listFollows',
  'notifications',
  'fcmTokens',
  'reportMeta',
  'askBingeMeta',
  'following',
  'followers',
  'friends',
  'friendRequests',
  'friendRequestsSent',
  'groupInvites',
] as const;

export async function collectUserDataSnapshots(uid: string): Promise<UserDataSnapshots> {
  const { db, collection, collectionGroup, doc, documentId, getDoc, getDocs, query, where } = await fsdb();
  const [
    profileSnap,
    watchlistSnap,
    episodeProgressSnap,
    notInterestedSnap,
    notificationsSnap,
    blockedSnap,
    followingSnap,
    followersSnap,
    friendsSnap,
    friendRequestsSnap,
    friendRequestsSentSnap,
    groupInvitesSnap,
    fcmTokensSnap,
    reportMetaSnap,
    askBingeMetaSnap,
    pauseHistorySnap,
    listFollowsSnap,
    reviewsSnap,
    reviewLikesSnap,
    reviewCommentsSnap,
    episodeReactionsSnap,
    listsSnap,
    editableListsSnap,
    sessionsSnap,
    groupsSnap,
  ] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDocs(collection(db, 'users', uid, 'watchlist')),
    getDocs(collection(db, 'users', uid, 'episodeProgress')),
    getDocs(collection(db, 'users', uid, 'notInterested')),
    getDocs(collection(db, 'users', uid, 'notifications')),
    getDocs(collection(db, 'users', uid, 'blocked')),
    getDocs(collection(db, 'users', uid, 'following')),
    getDocs(collection(db, 'users', uid, 'followers')),
    getDocs(collection(db, 'users', uid, 'friends')),
    getDocs(collection(db, 'users', uid, 'friendRequests')),
    getDocs(collection(db, 'users', uid, 'friendRequestsSent')),
    getDocs(collection(db, 'users', uid, 'groupInvites')),
    getDocs(collection(db, 'users', uid, 'fcmTokens')),
    getDocs(collection(db, 'users', uid, 'reportMeta')),
    getDocs(collection(db, 'users', uid, 'askBingeMeta')),
    getDocs(collection(db, 'users', uid, 'pauseHistory')),
    getDocs(collection(db, 'users', uid, 'listFollows')),
    getDocs(query(collection(db, 'reviews'), where('uid', '==', uid))),
    // doc-id = mitt uid (single-field collection-group-index på documentId)
    getDocs(query(collectionGroup(db, 'likes'), where(documentId(), '==', uid))),
    getDocs(query(collectionGroup(db, 'comments'), where('uid', '==', uid))),
    getDocs(query(collectionGroup(db, 'reactions'), where('uid', '==', uid))),
    getDocs(query(collection(db, 'lists'), where('uid', '==', uid))),
    getDocs(query(collection(db, 'lists'), where('editors', 'array-contains', uid))),
    getDocs(query(collection(db, 'sessions'), where('hostUid', '==', uid))),
    getDocs(
      query(collection(db, 'groups'), where('memberUids', 'array-contains', uid)),
    ),
  ]);

  return {
    profileSnap,
    watchlistSnap,
    episodeProgressSnap,
    notInterestedSnap,
    notificationsSnap,
    blockedSnap,
    followingSnap,
    followersSnap,
    friendsSnap,
    friendRequestsSnap,
    friendRequestsSentSnap,
    groupInvitesSnap,
    fcmTokensSnap,
    reportMetaSnap,
    askBingeMetaSnap,
    pauseHistorySnap,
    listFollowsSnap,
    reviewsSnap,
    reviewLikesSnap,
    reviewCommentsSnap,
    episodeReactionsSnap,
    listsSnap,
    editableListsSnap,
    sessionsSnap,
    groupsSnap,
  };
}
