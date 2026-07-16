import { fsdb } from './db';
import { getPublicProfileCards } from './publicProfile';

// Friend-system: mutuell relation som kompletterar ensidiga follow.
// Vänner får läsa privata watchlist-items (visibility='friends').
//
// Datamodell (alla under users/{uid}/...):
// - friends/{targetUid}: { since: Timestamp } — bekräftade vänner, speglas
// - friendRequests/{fromUid}: { sentAt, fromDisplayName, fromPhotoURL? } — incoming
// - friendRequestsSent/{toUid}: { sentAt } — outgoing-tracking för UI
//
// Doc-id = uid på den andre. Gör existens-checks i Firestore-regler triviala.

export type FriendStatus = 'none' | 'sent' | 'received' | 'friends';

export interface FriendUser {
  uid: string;
  displayName: string;
  photoURL: string | null;
  username: string | null;
  since: Date;
}

export interface FriendRequest {
  fromUid: string;
  fromDisplayName: string;
  fromPhotoURL: string | null;
  fromUsername: string | null;
  sentAt: Date;
}

// Skickar vänskapsförfrågan till `toUid`. Skapar:
// 1. users/{toUid}/friendRequests/{myUid}      — mottagaren ser pending
// 2. users/{myUid}/friendRequestsSent/{toUid}  — egen tracking för UI
//
// Atomisk batch så ingen halv-state kan lämnas. Idempotent — om request
// redan finns blir det merge.
export async function sendFriendRequest(
  myUid: string,
  myDisplayName: string,
  myPhotoURL: string | null,
  myUsername: string | null,
  toUid: string,
): Promise<void> {
  if (myUid === toUid) throw new Error('Cannot send friend request to yourself');
  const { db, doc, writeBatch, serverTimestamp } = await fsdb();
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', toUid, 'friendRequests', myUid), {
    fromUid: myUid,
    fromDisplayName: myDisplayName,
    fromPhotoURL: myPhotoURL,
    fromUsername: myUsername,
    sentAt: serverTimestamp(),
  });
  batch.set(doc(db, 'users', myUid, 'friendRequestsSent', toUid), {
    sentAt: serverTimestamp(),
  });
  await batch.commit();
}

// Avbryt egen utgående förfrågan (innan den accepteras).
export async function cancelFriendRequest(myUid: string, toUid: string): Promise<void> {
  const { db, doc, writeBatch } = await fsdb();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', toUid, 'friendRequests', myUid));
  batch.delete(doc(db, 'users', myUid, 'friendRequestsSent', toUid));
  await batch.commit();
}

// Mottagaren accepterar inkommen förfrågan. Skapar mutuell friend-relation
// + rensar request-docs. Allt i en batch så vi inte kan hamna i ett halvt
// tillstånd där request raderats men friends inte skapats (eller vice versa).
export async function acceptFriendRequest(myUid: string, fromUid: string): Promise<void> {
  const { db, doc, writeBatch, serverTimestamp } = await fsdb();
  const batch = writeBatch(db);
  // Mutuell friends-relation (båda håll).
  batch.set(doc(db, 'users', myUid, 'friends', fromUid), {
    since: serverTimestamp(),
  });
  batch.set(doc(db, 'users', fromUid, 'friends', myUid), {
    since: serverTimestamp(),
  });
  // Rensa request-spår.
  batch.delete(doc(db, 'users', myUid, 'friendRequests', fromUid));
  batch.delete(doc(db, 'users', fromUid, 'friendRequestsSent', myUid));
  await batch.commit();
}

// Avböj inkommen förfrågan utan att skapa vänskap. Rensar bara request-spår.
export async function declineFriendRequest(myUid: string, fromUid: string): Promise<void> {
  const { db, doc, writeBatch } = await fsdb();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', myUid, 'friendRequests', fromUid));
  batch.delete(doc(db, 'users', fromUid, 'friendRequestsSent', myUid));
  await batch.commit();
}

// Ta bort befintlig vän (båda håll). Inte detsamma som decline — denna
// körs när redan accepterad relation ska upphöra.
export async function removeFriend(myUid: string, targetUid: string): Promise<void> {
  const { db, doc, writeBatch } = await fsdb();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', myUid, 'friends', targetUid));
  batch.delete(doc(db, 'users', targetUid, 'friends', myUid));
  await batch.commit();
}

// Härleder relation-status mellan myUid och targetUid genom att kolla:
// 1. friends/{targetUid} på min sida → 'friends'
// 2. friendRequestsSent/{targetUid} på min sida → 'sent'
// 3. friendRequests/{targetUid} på min sida → 'received'
// 4. inget av ovan → 'none'
//
// Kollas i den ordning som ger snabbast svar för det vanligaste fallet
// (friends först eftersom det är det som mestast queryras).
export async function getFriendStatus(myUid: string, targetUid: string): Promise<FriendStatus> {
  if (myUid === targetUid) return 'none'; // Edge case — egen profil
  const { db, doc, getDoc } = await fsdb();
  const [friendsDoc, sentDoc, receivedDoc] = await Promise.all([
    getDoc(doc(db, 'users', myUid, 'friends', targetUid)),
    getDoc(doc(db, 'users', myUid, 'friendRequestsSent', targetUid)),
    getDoc(doc(db, 'users', myUid, 'friendRequests', targetUid)),
  ]);
  if (friendsDoc.exists()) return 'friends';
  if (sentDoc.exists()) return 'sent';
  if (receivedDoc.exists()) return 'received';
  return 'none';
}

// Hämtar bekräftade vänner för en användare. Returnerar en lista med
// resolved profile-data (display name, photo, username). Konsumeras av
// useFriends-hooken i UI.
export async function listFriends(myUid: string): Promise<FriendUser[]> {
  const { db, collection, getDocs } = await fsdb();
  const snap = await getDocs(collection(db, 'users', myUid, 'friends'));
  if (snap.empty) return [];
  // BIN-505: läs vännernas display-fält från publicProfiles-projektionen (jag
  // är vän → rules släpper igenom). users/{uid} är ägar-låst. En saknad card
  // = ännu ej backfillad projektion (INTE ett raderat konto — deletion-kaskaden
  // tar bort friend-doc:et), så vi DROPPAR aldrig en vän utan visar
  // fallback-namn tills projektionen finns.
  const cards = await getPublicProfileCards(snap.docs.map(d => d.id));
  const friends: FriendUser[] = [];
  for (const friendDoc of snap.docs) {
    const card = cards.get(friendDoc.id);
    const sinceTs = friendDoc.data().since;
    friends.push({
      uid: friendDoc.id,
      displayName: card?.displayName || 'Användare',
      photoURL: card?.photoURL ?? null,
      username: card?.username ?? null,
      since: sinceTs?.toDate?.() ?? new Date(),
    });
  }
  return friends;
}

// Hämtar inkomna pending requests. Konsumeras av useFriendRequests-hooken.
export async function listFriendRequests(myUid: string): Promise<FriendRequest[]> {
  const { db, collection, getDocs } = await fsdb();
  const snap = await getDocs(collection(db, 'users', myUid, 'friendRequests'));
  return snap.docs.map(d => {
    const data = d.data();
    return {
      fromUid: d.id,
      fromDisplayName: (data.fromDisplayName as string) ?? 'Användare',
      fromPhotoURL: (data.fromPhotoURL as string | null) ?? null,
      fromUsername: (data.fromUsername as string | null) ?? null,
      sentAt: data.sentAt?.toDate?.() ?? new Date(),
    };
  });
}
