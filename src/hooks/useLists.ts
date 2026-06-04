'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, serverTimestamp, arrayUnion, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
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
    const q = query(
      collection(db, 'lists'),
      where('uid', '==', uid),
      orderBy('updatedAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, snap => {
      setLists(snap.docs.map(d => docToList(d.id, d.data())));
    });
    return () => unsub();
  }, [uid]);

  const createList = useCallback(async (title: string, description: string, isPublic: boolean) => {
    if (!uid) return;
    await addDoc(collection(db, 'lists'), {
      uid, title, description, isPublic, items: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  }, [uid]);

  const deleteList = useCallback(async (listId: string) => {
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
    await updateDoc(doc(db, 'lists', listId), {
      items: arrayUnion({ ...item, addedAt: new Date() }),
      updatedAt: serverTimestamp(),
    });
  }, []);

  const removeItemFromList = useCallback(async (listId: string, tmdbId: number) => {
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
      const snap = await getDoc(doc(db, 'lists', listId));
      if (!snap.exists()) return null;
      return docToList(snap.id, snap.data());
    },
    staleTime: 60_000,
  });
}
