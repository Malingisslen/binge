'use client';

import { createContext, useContext, useMemo, useState, useCallback, useEffect, type ReactNode } from 'react';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { useAuth } from '@/contexts/AuthContext';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { MediaType } from '@/types';

export interface NotInterestedItem {
  tmdbId: number;
  mediaType: MediaType;
}

interface NotInterestedState {
  items: NotInterestedItem[];
  // true tills första Firestore-snapshotten landat. Konsumenter (rekommenda-
  // tioner) gate:ar på den så avfärdade titlar inte blinkar in på kall laddning
  // medan has() ännu returnerar false för allt (BIN-37).
  loading: boolean;
  // BIN-560 Phase 4: all three take (mediaType, tmdbId) — mediaType is needed to
  // address the namespaced doc id and disambiguate a movie from a same-numbered TV
  // show, and the arg order matches the WatchlistContext mutator convention.
  add: (mediaType: MediaType, tmdbId: number) => Promise<void>;
  remove: (mediaType: MediaType, tmdbId: number) => Promise<void>;
  has: (mediaType: MediaType, tmdbId: number) => boolean;
}

const NotInterestedContext = createContext<NotInterestedState>({
  items: [],
  loading: true,
  add: async () => {},
  remove: async () => {},
  has: () => false,
});

export function NotInterestedProvider({ children }: { children: ReactNode }) {
  const { uid } = useAuth();
  const [items, setItems] = useState<NotInterestedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setItems([]); setLoading(false); return; }
    setLoading(true);
    return lazySubscribe(({ db, collection, onSnapshot }) =>
      onSnapshot(collection(db, 'users', uid, 'notInterested'), (snap) => {
        setItems(snap.docs.map(d => ({
          tmdbId: d.data().tmdbId as number,
          mediaType: d.data().mediaType as MediaType,
        })));
        setLoading(false);
      }));
  }, [uid]);

  const add = useCallback(async (mediaType: MediaType, tmdbId: number) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'notInterested', mediaTypeDocId(mediaType, tmdbId));
    await setDoc(ref, {
      tmdbId,
      mediaType,
      addedAt: serverTimestamp(),
    }, { merge: true });
  }, [uid]);

  const remove = useCallback(async (mediaType: MediaType, tmdbId: number) => {
    if (!uid) return;
    const { db, doc, deleteDoc } = await fsdb();
    await deleteDoc(doc(db, 'users', uid, 'notInterested', mediaTypeDocId(mediaType, tmdbId)));
  }, [uid]);

  // Composite-keyed set so a movie/TV tmdbId clash can't false-share "not interested".
  const idSet = useMemo(() => new Set(items.map(i => mediaTypeDocId(i.mediaType, i.tmdbId))), [items]);
  const has = useCallback((mediaType: MediaType, tmdbId: number) => idSet.has(mediaTypeDocId(mediaType, tmdbId)), [idSet]);

  const value = useMemo(() => ({ items, loading, add, remove, has }), [items, loading, add, remove, has]);

  return (
    <NotInterestedContext.Provider value={value}>
      {children}
    </NotInterestedContext.Provider>
  );
}

export function useNotInterested() {
  return useContext(NotInterestedContext);
}
