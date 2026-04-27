import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  addDoc,
  query,
  where,
  serverTimestamp,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  writeBatch,
} from 'firebase/firestore';
import { db } from './config';
import { toDate, generateSecureToken, sha256Hex } from './utils';
import type {
  Group,
  GroupDefaults,
  GroupMember,
  GroupRole,
  GroupWatchlistItem,
  MediaType,
} from '@/types';

// Skapar en grupp och returnerar både groupId och plaintext-tokenet. Tokenet
// hashas (sha256) innan det persisteras — plaintext finns BARA hos klienten
// och i URL:n som ägaren delar. Caller ansvarar för att cacha plaintext (t.ex.
// localStorage) ifall ägaren vill se länken igen utan att rotera.
export async function createGroup(params: {
  ownerUid: string;
  ownerDisplayName: string;
  ownerUsername: string | null;
  ownerPhotoURL: string | null;
  ownerProviders: number[];
  name: string;
  defaults: GroupDefaults;
}): Promise<{ groupId: string; inviteToken: string }> {
  const inviteToken = generateSecureToken();
  const inviteTokenHash = await sha256Hex(inviteToken);

  const groupRef = await addDoc(collection(db, 'groups'), {
    name: params.name,
    ownerUid: params.ownerUid,
    memberUids: [params.ownerUid],
    defaults: params.defaults,
    inviteTokenHash,
    inviteTokenRotatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(doc(db, 'groups', groupRef.id, 'members', params.ownerUid), {
    uid: params.ownerUid,
    displayName: params.ownerDisplayName,
    username: params.ownerUsername,
    photoURL: params.ownerPhotoURL,
    providers: params.ownerProviders,
    role: 'owner',
    notifications: true,
    joinedAt: serverTimestamp(),
  });

  return { groupId: groupRef.id, inviteToken };
}

export async function updateGroup(
  groupId: string,
  patch: Partial<Pick<Group, 'name' | 'defaults'>>,
): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

// Roterar inbjudningstoken: genererar ny plaintext, lagrar ny hash, returnerar
// plaintext. Befintliga invitelänkar (med gamla plaintext-tokenet) slutar
// fungera direkt eftersom ny hash inte matchar.
export async function rotateInviteToken(groupId: string): Promise<string> {
  const inviteToken = generateSecureToken();
  const inviteTokenHash = await sha256Hex(inviteToken);
  await updateDoc(doc(db, 'groups', groupId), {
    inviteTokenHash,
    inviteTokenRotatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return inviteToken;
}

export async function hasInGroupWatchlist(groupId: string, tmdbId: number): Promise<boolean> {
  const snap = await getDoc(doc(db, 'groups', groupId, 'watchlist', String(tmdbId)));
  return snap.exists();
}

export async function disableInviteToken(groupId: string): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId), {
    inviteTokenHash: null,
    updatedAt: serverTimestamp(),
  });
}

// Joina en grupp via plaintext-token. Två-stegs-flöde:
//
// 1. Skriv joinAttempts/{uid} med plaintext-tokenet. Firestore-regeln hashar
//    plaintext server-side och jämför mot inviteTokenHash på grupp-doc:et.
//    Om hash matchar accepteras dokumentet — annars permission-denied.
// 2. Uppdatera grupp-doc:et: lägg till sig själv i memberUids + skapa
//    members/{uid}-doc. Grupp-update-regeln verifierar bara att joinAttempts-
//    doc:et existerar för request.auth.uid; den bevisar att hash-checken
//    passerade.
//
// Om steg 1 redan finns från tidigare misslyckad join, ta bort och försök igen
// (självborttag är tillåtet).
export async function joinGroupViaToken(params: {
  groupId: string;
  token: string;
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  providers: number[];
}): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'invalid_token' | 'already_member' }> {
  const ref = doc(db, 'groups', params.groupId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, reason: 'not_found' };
  const data = snap.data();
  const memberUids: string[] = data.memberUids ?? [];
  if (memberUids.includes(params.uid)) return { ok: false, reason: 'already_member' };
  if (!data.inviteTokenHash) return { ok: false, reason: 'invalid_token' };

  // Steg 1 — skriv joinAttempt. Rule:n hashar params.token server-side och
  // verifierar att den matchar lagrad inviteTokenHash. Vid invalid token får
  // vi permission-denied här.
  const attemptRef = doc(db, 'groups', params.groupId, 'joinAttempts', params.uid);
  try {
    // Best-effort cleanup om gammalt attempt-doc finns kvar (t.ex. efter
    // tidigare misslyckad rotation). Reglerna tillåter självborttag.
    await deleteDoc(attemptRef).catch(() => {});
    await setDoc(attemptRef, {
      token: params.token,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Permission-denied = hash matchade inte
    console.error('joinAttempt rejected', err);
    return { ok: false, reason: 'invalid_token' };
  }

  // Steg 2 — uppdatera grupp + lägg till member-doc. Rule:n verifierar att
  // joinAttempts/{auth.uid} existerar (vilket den nu gör efter steg 1).
  try {
    const batch = writeBatch(db);
    batch.update(ref, {
      memberUids: arrayUnion(params.uid),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'groups', params.groupId, 'members', params.uid), {
      uid: params.uid,
      displayName: params.displayName,
      username: params.username,
      photoURL: params.photoURL,
      providers: params.providers,
      role: 'member',
      notifications: true,
      joinedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    console.error('group update rejected', err);
    return { ok: false, reason: 'invalid_token' };
  }

  // Best-effort: städa upp joinAttempt-doc:et nu när vi är medlem. Inte
  // säkerhetskritiskt — token är ändå "spent" (om den roteras blir hashen
  // ny och plaintext här blir värdelös).
  void deleteDoc(attemptRef).catch(() => {});

  return { ok: true };
}

export async function addMemberByUid(params: {
  groupId: string;
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  providers: number[];
}): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'groups', params.groupId), {
    memberUids: arrayUnion(params.uid),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'groups', params.groupId, 'members', params.uid), {
    uid: params.uid,
    displayName: params.displayName,
    username: params.username,
    photoURL: params.photoURL,
    providers: params.providers,
    role: 'member',
    notifications: true,
    joinedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function removeMember(groupId: string, uid: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'groups', groupId), {
    memberUids: arrayRemove(uid),
    updatedAt: serverTimestamp(),
  });
  batch.delete(doc(db, 'groups', groupId, 'members', uid));
  await batch.commit();
}

export async function leaveGroup(groupId: string, uid: string): Promise<void> {
  return removeMember(groupId, uid);
}

export async function deleteGroup(groupId: string): Promise<void> {
  // Best-effort cleanup. Members + watchlist subcollections must be deleted
  // before the parent doc to avoid orphaned data; in production this would
  // happen in a Cloud Function. For MVP we delete what we can client-side.
  const [membersSnap, watchlistSnap] = await Promise.all([
    getDocs(collection(db, 'groups', groupId, 'members')),
    getDocs(collection(db, 'groups', groupId, 'watchlist')),
  ]);
  const batch = writeBatch(db);
  membersSnap.docs.forEach(d => batch.delete(d.ref));
  watchlistSnap.docs.forEach(d => batch.delete(d.ref));
  batch.delete(doc(db, 'groups', groupId));
  await batch.commit();
}

export async function updateMemberProviders(
  groupId: string,
  uid: string,
  providers: number[],
): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId, 'members', uid), {
    providers,
  });
}

export async function setMemberRating(params: {
  groupId: string;
  tmdbId: number;
  uid: string;
  rating: number | null;
}): Promise<void> {
  const ref = doc(db, 'groups', params.groupId, 'watchlist', String(params.tmdbId));
  await updateDoc(ref, {
    [`memberRatings.${params.uid}`]: params.rating == null ? deleteField() : params.rating,
  });
}

export async function addToGroupWatchlist(params: {
  groupId: string;
  uid: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
}): Promise<void> {
  await setDoc(doc(db, 'groups', params.groupId, 'watchlist', String(params.tmdbId)), {
    tmdbId: params.tmdbId,
    mediaType: params.mediaType,
    title: params.title,
    posterPath: params.posterPath,
    releaseYear: params.releaseYear,
    addedBy: params.uid,
    addedAt: serverTimestamp(),
    memberRatings: {},
  });
}

export async function removeFromGroupWatchlist(groupId: string, tmdbId: number): Promise<void> {
  await deleteDoc(doc(db, 'groups', groupId, 'watchlist', String(tmdbId)));
}

// Skriver min progress på en titel i en specifik grupp. Subcollection-path:
// groups/{id}/watchlist/{tmdbId}/progress/{uid}
//
// Ersätter den gamla designen där useGroupMemberProgress läste medlemmarnas
// personliga watchlist-items direkt — det funkar inte längre när medlemmar
// satt defaultVisibility='friends'/'private'. Grupp-scoped progress läses
// av alla medlemmar oavsett deras profil-visibility (åtkomstgränsen är
// gruppmedlemskap, inte profil-publik-flagga).
export async function setGroupMemberProgress(params: {
  groupId: string;
  tmdbId: number;
  uid: string;
  lastWatchedSeason: number | null;
  lastWatchedEpisode: number | null;
  status?: string | null;
}): Promise<void> {
  const ref = doc(
    db, 'groups', params.groupId, 'watchlist', String(params.tmdbId),
    'progress', params.uid,
  );
  await setDoc(ref, {
    lastWatchedSeason: params.lastWatchedSeason,
    lastWatchedEpisode: params.lastWatchedEpisode,
    status: params.status ?? null,
    syncedAt: serverTimestamp(),
  }, { merge: true });
}

// Sync-trigger: körs från WatchlistContext.updateProgress. Hittar alla
// grupper jag är medlem i där titeln finns på gruppens watchlist, skriver
// min progress till deras progress-subcollection. Fire-and-forget — fel
// per grupp slukas så vi aldrig blockerar updateProgress på en flaky
// gruppwrite.
//
// Kostnad i Firestore-reads: 1 query (mina grupper) + N getDoc per grupp
// för att kolla om titeln finns. För 5 grupper ≈ 5 reads + M writes där
// M är antal grupper som faktiskt har titeln. Acceptabelt — körs bara på
// progress-uppdateringar, inte på rendering.
export async function syncProgressToGroups(params: {
  uid: string;
  tmdbId: number;
  lastWatchedSeason: number | null;
  lastWatchedEpisode: number | null;
  status?: string | null;
}): Promise<void> {
  try {
    const groupsSnap = await getDocs(
      query(collection(db, 'groups'), where('memberUids', 'array-contains', params.uid)),
    );
    if (groupsSnap.empty) return;
    await Promise.all(groupsSnap.docs.map(async groupDoc => {
      try {
        const itemRef = doc(db, 'groups', groupDoc.id, 'watchlist', String(params.tmdbId));
        const itemSnap = await getDoc(itemRef);
        if (!itemSnap.exists()) return;
        await setGroupMemberProgress({
          groupId: groupDoc.id,
          tmdbId: params.tmdbId,
          uid: params.uid,
          lastWatchedSeason: params.lastWatchedSeason,
          lastWatchedEpisode: params.lastWatchedEpisode,
          status: params.status ?? null,
        });
      } catch (err) {
        // Logga per grupp så en flaky grupp inte tystar de andra.
        console.warn('[group-progress-sync]', groupDoc.id, err);
      }
    }));
  } catch (err) {
    console.warn('[group-progress-sync]', err);
  }
}

// ---- Doc → object converters ----

export function groupDocToObject(id: string, data: Record<string, unknown>): Group {
  return {
    id,
    name: (data.name as string) ?? '',
    ownerUid: (data.ownerUid as string) ?? '',
    memberUids: (data.memberUids as string[]) ?? [],
    defaults: (data.defaults as GroupDefaults) ?? {
      providerMode: 'intersect',
      aggregation: 'least_misery',
      mediaType: 'both',
    },
    inviteTokenHash: (data.inviteTokenHash as string | null) ?? null,
    inviteTokenRotatedAt: data.inviteTokenRotatedAt ? toDate(data.inviteTokenRotatedAt) : null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function memberDocToObject(id: string, data: Record<string, unknown>): GroupMember {
  return {
    uid: (data.uid as string) ?? id,
    displayName: (data.displayName as string) ?? '',
    username: (data.username as string | null) ?? null,
    photoURL: (data.photoURL as string | null) ?? null,
    providers: (data.providers as number[]) ?? [],
    role: ((data.role as GroupRole) ?? 'member'),
    joinedAt: toDate(data.joinedAt),
    notifications: (data.notifications as boolean) ?? true,
  };
}

export function watchlistDocToObject(id: string, data: Record<string, unknown>): GroupWatchlistItem {
  return {
    tmdbId: Number(id),
    mediaType: (data.mediaType as MediaType) ?? 'movie',
    title: (data.title as string) ?? '',
    posterPath: (data.posterPath as string | null) ?? null,
    releaseYear: (data.releaseYear as number | null) ?? null,
    addedBy: (data.addedBy as string) ?? '',
    addedAt: toDate(data.addedAt),
    memberRatings: (data.memberRatings as Record<string, number>) ?? {},
  };
}

// ---- Subscriptions / fetchers ----

export function subscribeToGroup(
  groupId: string,
  cb: (group: Group | null) => void,
): () => void {
  return onSnapshot(doc(db, 'groups', groupId), snap => {
    if (!snap.exists()) { cb(null); return; }
    cb(groupDocToObject(snap.id, snap.data()));
  });
}

export function subscribeToGroupMembers(
  groupId: string,
  cb: (members: GroupMember[]) => void,
): () => void {
  return onSnapshot(collection(db, 'groups', groupId, 'members'), snap => {
    cb(snap.docs.map(d => memberDocToObject(d.id, d.data())));
  });
}

export function subscribeToGroupWatchlist(
  groupId: string,
  cb: (items: GroupWatchlistItem[]) => void,
): () => void {
  return onSnapshot(collection(db, 'groups', groupId, 'watchlist'), snap => {
    cb(snap.docs.map(d => watchlistDocToObject(d.id, d.data())));
  });
}

export function subscribeToMyGroups(
  uid: string,
  cb: (groups: Group[]) => void,
): () => void {
  const q = query(collection(db, 'groups'), where('memberUids', 'array-contains', uid));
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => groupDocToObject(d.id, d.data())));
  });
}

export async function getGroupOnce(groupId: string): Promise<Group | null> {
  const snap = await getDoc(doc(db, 'groups', groupId));
  if (!snap.exists()) return null;
  return groupDocToObject(snap.id, snap.data());
}
