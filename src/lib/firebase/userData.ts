import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { db } from './config';

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
  friendsSnap: QuerySnapshot;
  friendRequestsSnap: QuerySnapshot;
  friendRequestsSentSnap: QuerySnapshot;
  // FCM web-push tokens (Fas 4). Inkluderas i delete-cascade. För export
  // behöver vi inte exponera tokens (de är device-specifika och meningslösa
  // utanför Firebase) — buildUserExport kan hoppa över detta fält.
  fcmTokensSnap: QuerySnapshot;
  // Sparbeslut-historik (Streamingrådgivaren) — skrivs av resumeProvider.
  // Inkluderas i export + delete-cascade.
  pauseHistorySnap: QuerySnapshot;
  reviewsSnap: QuerySnapshot;
  reviewLikesSnap: QuerySnapshot;
  reviewCommentsSnap: QuerySnapshot;
  listsSnap: QuerySnapshot;
  sessionsSnap: QuerySnapshot;
  groupsSnap: QuerySnapshot;
}

export async function collectUserDataSnapshots(uid: string): Promise<UserDataSnapshots> {
  const [
    profileSnap,
    watchlistSnap,
    episodeProgressSnap,
    notInterestedSnap,
    notificationsSnap,
    blockedSnap,
    followingSnap,
    friendsSnap,
    friendRequestsSnap,
    friendRequestsSentSnap,
    fcmTokensSnap,
    pauseHistorySnap,
    reviewsSnap,
    reviewLikesSnap,
    reviewCommentsSnap,
    listsSnap,
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
    getDocs(collection(db, 'users', uid, 'friends')),
    getDocs(collection(db, 'users', uid, 'friendRequests')),
    getDocs(collection(db, 'users', uid, 'friendRequestsSent')),
    getDocs(collection(db, 'users', uid, 'fcmTokens')),
    getDocs(collection(db, 'users', uid, 'pauseHistory')),
    getDocs(query(collection(db, 'reviews'), where('uid', '==', uid))),
    // doc-id = mitt uid (single-field collection-group-index på documentId)
    getDocs(query(collectionGroup(db, 'likes'), where(documentId(), '==', uid))),
    getDocs(query(collectionGroup(db, 'comments'), where('uid', '==', uid))),
    getDocs(query(collection(db, 'lists'), where('uid', '==', uid))),
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
    friendsSnap,
    friendRequestsSnap,
    friendRequestsSentSnap,
    fcmTokensSnap,
    pauseHistorySnap,
    reviewsSnap,
    reviewLikesSnap,
    reviewCommentsSnap,
    listsSnap,
    sessionsSnap,
    groupsSnap,
  };
}
