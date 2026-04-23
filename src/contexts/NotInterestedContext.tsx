'use client';

import { createContext, useContext, useMemo, useState, useCallback, useEffect, type ReactNode } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/contexts/AuthContext';
import type { MediaType } from '@/types';

export interface NotInterestedItem {
  tmdbId: number;
  mediaType: MediaType;
}

interface NotInterestedState {
  items: NotInterestedItem[];
  add: (tmdbId: number, mediaType: MediaType) => Promise<void>;
  remove: (tmdbId: number) => Promise<void>;
  has: (tmdbId: number) => boolean;
}

const NotInterestedContext = createContext<NotInterestedState>({
  items: [],
  add: async () => {},
  remove: async () => {},
  has: () => false,
});

export function NotInterestedProvider({ children }: { children: ReactNode }) {
  const { uid } = useAuth();
  const [items, setItems] = useState<NotInterestedItem[]>([]);

  useEffect(() => {
    if (!uid) { setItems([]); return; }
    const ref = collection(db, 'users', uid, 'notInterested');
    const unsub = onSnapshot(ref, (snap) => {
      setItems(snap.docs.map(d => ({
        tmdbId: d.data().tmdbId as number,
        mediaType: d.data().mediaType as MediaType,
      })));
    });
    return () => unsub();
  }, [uid]);

  const add = useCallback(async (tmdbId: number, mediaType: MediaType) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'notInterested', String(tmdbId));
    await setDoc(ref, {
      tmdbId,
      mediaType,
      addedAt: serverTimestamp(),
    }, { merge: true });
  }, [uid]);

  const remove = useCallback(async (tmdbId: number) => {
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'notInterested', String(tmdbId)));
  }, [uid]);

  const idSet = useMemo(() => new Set(items.map(i => i.tmdbId)), [items]);
  const has = useCallback((tmdbId: number) => idSet.has(tmdbId), [idSet]);

  const value = useMemo(() => ({ items, add, remove, has }), [items, add, remove, has]);

  return (
    <NotInterestedContext.Provider value={value}>
      {children}
    </NotInterestedContext.Provider>
  );
}

export function useNotInterested() {
  return useContext(NotInterestedContext);
}
