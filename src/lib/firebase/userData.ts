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
  // editorship is my data). NOT deleted here — the list is owned by someone
  // else (rules: only the owner writes metadata); my uid lingers in editors[]
  // until they remove me, same as the followers-snapshot precedent.
  editableListsSnap: QuerySnapshot;
  sessionsSnap: QuerySnapshot;
  groupsSnap: QuerySnapshot;
}

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
