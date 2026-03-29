'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/contexts/AuthContext';
import type { WatchlistItem, WatchStatus, MediaType } from '@/types';

function migrateStatus(raw: string): { status: WatchStatus; dropped: boolean } {
  switch (raw) {
    case 'watching':
    case 'want_to_watch':
      return { status: 'följer', dropped: false };
    case 'watched':
      return { status: 'sedd', dropped: false };
    case 'dropped':
      return { status: 'följer', dropped: true };
    case 'följer':
    case 'sedd':
      return { status: raw as WatchStatus, dropped: false };
    default:
      return { status: 'följer', dropped: false };
  }
}

function docToItem(data: Record<string, unknown>): WatchlistItem {
  const { status, dropped } = migrateStatus(data.status as string);
  return {
    tmdbId: data.tmdbId as number,
    mediaType: data.mediaType as MediaType,
    status,
    rating: (data.rating as number) ?? null,
    notes: (data.notes as string) ?? null,
    title: data.title as string,
    posterPath: (data.posterPath as string) ?? null,
    releaseYear: (data.releaseYear as number) ?? null,
    totalSeasons: (data.totalSeasons as number) ?? null,
    lastWatchedSeason: (data.lastWatchedSeason as number) ?? null,
    lastWatchedEpisode: (data.lastWatchedEpisode as number) ?? null,
    dropped: (data.dropped as boolean) ?? dropped,
    rewatchCount: (data.rewatchCount as number) ?? 0,
    providers: (data.providers as number[]) ?? [],
    addedAt: toDate(data.addedAt),
    updatedAt: toDate(data.updatedAt),
    watchedAt: data.watchedAt ? toDate(data.watchedAt) : null,
  };
}

interface WatchlistState {
  items: WatchlistItem[];
  addItem: (item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount'>) => Promise<void>;
  updateStatus: (tmdbId: number, status: WatchStatus) => Promise<void>;
  updateRating: (tmdbId: number, rating: number | null) => Promise<void>;
  updateNotes: (tmdbId: number, notes: string | null) => Promise<void>;
  updateProgress: (tmdbId: number, season: number, episode: number) => Promise<void>;
  removeItem: (tmdbId: number) => Promise<void>;
  getByStatus: (status: WatchStatus, mediaType?: MediaType) => WatchlistItem[];
  getItem: (tmdbId: number) => WatchlistItem | null;
}

const WatchlistContext = createContext<WatchlistState>({
  items: [],
  addItem: async () => {},
  updateStatus: async () => {},
  updateRating: async () => {},
  updateNotes: async () => {},
  updateProgress: async () => {},
  removeItem: async () => {},
  getByStatus: () => [],
  getItem: () => null,
});

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { uid } = useAuth();
  const [items, setItems] = useState<WatchlistItem[]>([]);

  useEffect(() => {
    if (!uid) { setItems([]); return; }
    const ref = collection(db, 'users', uid, 'watchlist');
    const unsub = onSnapshot(ref, (snap) => {
      setItems(snap.docs.map(d => docToItem(d.data())));
    });
    return () => unsub();
  }, [uid]);

  const addItem = useCallback(async (item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount'>) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'watchlist', String(item.tmdbId));
    await setDoc(ref, {
      ...item,
      dropped: false,
      addedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      watchedAt: item.status === 'sedd' ? serverTimestamp() : null,
    }, { merge: true });
  }, [uid]);

  const updateStatus = useCallback(async (tmdbId: number, status: WatchStatus) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    const currentItem = items.find(i => i.tmdbId === tmdbId);
    const isRewatch = status === 'sedd' && currentItem?.status === 'sedd';
    await setDoc(ref, {
      status,
      updatedAt: serverTimestamp(),
      ...(status === 'sedd' ? { watchedAt: serverTimestamp() } : {}),
      ...(isRewatch ? { rewatchCount: (currentItem?.rewatchCount ?? 0) + 1 } : {}),
    }, { merge: true });
  }, [uid, items]);

  const updateRating = useCallback(async (tmdbId: number, rating: number | null) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    await setDoc(ref, { rating, updatedAt: serverTimestamp() }, { merge: true });
  }, [uid]);

  const updateNotes = useCallback(async (tmdbId: number, notes: string | null) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    await setDoc(ref, { notes, updatedAt: serverTimestamp() }, { merge: true });
  }, [uid]);

  const updateProgress = useCallback(async (tmdbId: number, season: number, episode: number) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    await setDoc(ref, {
      lastWatchedSeason: season,
      lastWatchedEpisode: episode,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [uid]);

  const removeItem = useCallback(async (tmdbId: number) => {
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'watchlist', String(tmdbId)));
  }, [uid]);

  const getByStatus = useCallback((status: WatchStatus, mediaType?: MediaType) => {
    return items.filter(i => i.status === status && (!mediaType || i.mediaType === mediaType));
  }, [items]);

  const getItem = useCallback((tmdbId: number) => {
    return items.find(i => i.tmdbId === tmdbId) ?? null;
  }, [items]);

  return (
    <WatchlistContext.Provider value={{
      items, addItem, updateStatus, updateRating, updateNotes, updateProgress, removeItem, getByStatus, getItem,
    }}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  return useContext(WatchlistContext);
}
