'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/contexts/AuthContext';
import type { UserList, UserListItem } from '@/types';

function docToList(id: string, data: Record<string, unknown>): UserList {
  return {
    id,
    uid: data.uid as string,
    title: data.title as string,
    description: (data.description as string) ?? '',
    isPublic: (data.isPublic as boolean) ?? false,
    items: ((data.items as UserListItem[]) ?? []).map(i => ({
      ...i,
      addedAt: toDate(i.addedAt),
    })),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

// Varför ingen useInfiniteQuery här (A4.2): en lista lagrar sina titlar som
// ett *array-fält* (`items`, muteras via arrayUnion), inte som en
// subcollection — så det finns ingen obegränsad *collection*-query att
// paginera. `useMyLists` är ett realtids-`onSnapshot`-abonnemang med
// `limit(100)` (read-bomb-skydd), och `usePublicList` är en enda `getDoc`.
// Att konvertera någon av dem till cursor-paginering skulle antingen tappa
// realtid eller vara felaktigt. Om vi senare lägger till en publik
// *lists-collection*-query (t.ex. "bläddra alla publika listor") är
// `src/hooks/pagination.ts` (Task 3.8) mönstret för den.
export function useMyLists() {
  const { uid } = useAuth();
  const [lists, setLists] = useState<UserList[]>([]);

  useEffect(() => {
    if (!uid) { setLists([]); return; }
    // Säkerhet mot read-bomb om en användare råkar skapa hundratals listor.
    // 100 räcker för normalbruk — paginering läggs till i UI innan vi bryr
    // oss om fler.
    return lazySubscribe(({ db, collection, query, where, orderBy, limit, onSnapshot }) =>
      onSnapshot(query(
        collection(db, 'lists'),
        where('uid', '==', uid),
        orderBy('updatedAt', 'desc'),
        limit(100),
      ), snap => {
        setLists(snap.docs.map(d => docToList(d.id, d.data())));
      }));
  }, [uid]);

  const createList = useCallback(async (title: string, description: string, isPublic: boolean) => {
    if (!uid) return;
    const { db, addDoc, collection, serverTimestamp } = await fsdb();
    await addDoc(collection(db, 'lists'), {
      uid, title, description, isPublic, items: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  }, [uid]);

  const deleteList = useCallback(async (listId: string) => {
    const { db, doc, deleteDoc } = await fsdb();
    await deleteDoc(doc(db, 'lists', listId));
  }, []);

  const { addItemToList, removeItemFromList } = useListMutations();

  return { lists, createList, deleteList, addItemToList, removeItemFromList };
}

/**
 * Lättviktiga mutationer för enstaka listor — utan `onSnapshot`-abonnemang.
 * Använd detta på listsidan där vi bara vill mutera den aktuella listan och
 * inte ladda hela `users/{uid}`-listsamlingen.
 */
export function useListMutations() {
  const addItemToList = useCallback(async (listId: string, item: Omit<UserListItem, 'addedAt'>) => {
    const { db, doc, updateDoc, arrayUnion, serverTimestamp } = await fsdb();
    await updateDoc(doc(db, 'lists', listId), {
      items: arrayUnion({ ...item, addedAt: new Date() }),
      updatedAt: serverTimestamp(),
    });
  }, []);

  const removeItemFromList = useCallback(async (listId: string, tmdbId: number) => {
    const { db, doc, getDoc, updateDoc, serverTimestamp } = await fsdb();
    const snap = await getDoc(doc(db, 'lists', listId));
    if (!snap.exists()) return;
    const items = (snap.data().items as UserListItem[]).filter(i => i.tmdbId !== tmdbId);
    await updateDoc(doc(db, 'lists', listId), { items, updatedAt: serverTimestamp() });
  }, []);

  return { addItemToList, removeItemFromList };
}

export function usePublicList(listId: string) {
  return useQuery({
    queryKey: ['public-list', listId],
    queryFn: async () => {
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'lists', listId));
      if (!snap.exists()) return null;
      return docToList(snap.id, snap.data());
    },
    staleTime: 60_000,
  });
}

// BIN-96: list following. The follow record lives on the FOLLOWER
// (users/{uid}/listFollows/{listId}) so "mina följda listor" is a single
// own-subcollection read. Lists are already public-read.
export function useListFollows() {
  const { uid } = useAuth();
  const [followedIds, setFollowedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!uid) { setFollowedIds([]); return; }
    return lazySubscribe(({ db, collection, onSnapshot }) =>
      onSnapshot(collection(db, 'users', uid, 'listFollows'), snap => {
        setFollowedIds(snap.docs.map(d => d.id));
      }));
  }, [uid]);

  const followList = useCallback(async (listId: string, listOwnerUid: string) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    await setDoc(doc(db, 'users', uid, 'listFollows', listId), {
      listOwnerUid,
      followedAt: serverTimestamp(),
    });
  }, [uid]);

  const unfollowList = useCallback(async (listId: string) => {
    if (!uid) return;
    const { db, doc, deleteDoc } = await fsdb();
    await deleteDoc(doc(db, 'users', uid, 'listFollows', listId));
  }, [uid]);

  const isFollowing = useCallback((listId: string) => followedIds.includes(listId), [followedIds]);

  return { followedIds, isFollowing, followList, unfollowList };
}

// Loads the actual list docs for the user's followed lists (public-read getDocs,
// cached). Manual surface (/my/lists) — bounded by the follow count.
export function useFollowedLists() {
  const { followedIds } = useListFollows();
  const key = [...followedIds].sort().join(',');
  const { data } = useQuery({
    queryKey: ['followed-lists', key],
    enabled: followedIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<UserList[]> => {
      const { db, doc, getDoc } = await fsdb();
      const snaps = await Promise.all(followedIds.map(id => getDoc(doc(db, 'lists', id))));
      return snaps
        .filter(s => s.exists())
        .map(s => docToList(s.id, s.data() as Record<string, unknown>));
    },
  });
  return data ?? [];
}
