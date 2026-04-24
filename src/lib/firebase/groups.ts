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
import { toDate, randomId } from './utils';
import type {
  Group,
  GroupDefaults,
  GroupMember,
  GroupRole,
  GroupWatchlistItem,
  MediaType,
} from '@/types';

export async function createGroup(params: {
  ownerUid: string;
  ownerDisplayName: string;
  ownerUsername: string | null;
  ownerPhotoURL: string | null;
  ownerProviders: number[];
  name: string;
  defaults: GroupDefaults;
}): Promise<string> {
  const groupRef = await addDoc(collection(db, 'groups'), {
    name: params.name,
    ownerUid: params.ownerUid,
    memberUids: [params.ownerUid],
    defaults: params.defaults,
    inviteToken: randomId(),
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

  return groupRef.id;
}

export async function updateGroup(
  groupId: string,
  patch: Partial<Pick<Group, 'name' | 'defaults' | 'inviteToken'>>,
): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function rotateInviteToken(groupId: string): Promise<string> {
  const token = randomId();
  // updateDoc direkt (bypass updateGroup) för att kunna skriva
  // inviteTokenRotatedAt som ligger utanför Pick-typen på updateGroup.
  await updateDoc(doc(db, 'groups', groupId), {
    inviteToken: token,
    inviteTokenRotatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return token;
}

export async function hasInGroupWatchlist(groupId: string, tmdbId: number): Promise<boolean> {
  const snap = await getDoc(doc(db, 'groups', groupId, 'watchlist', String(tmdbId)));
  return snap.exists();
}

export async function disableInviteToken(groupId: string): Promise<void> {
  await updateGroup(groupId, { inviteToken: null });
}

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
  if (!data.inviteToken || data.inviteToken !== params.token) {
    return { ok: false, reason: 'invalid_token' };
  }
  const memberUids: string[] = data.memberUids ?? [];
  if (memberUids.includes(params.uid)) return { ok: false, reason: 'already_member' };

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
    inviteToken: (data.inviteToken as string | null) ?? null,
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
