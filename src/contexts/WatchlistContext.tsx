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
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/contexts/AuthContext';
import { trackEvent } from '@/lib/analytics';
import { migrateStatus } from '@/lib/watchStatus.migration';
import type { WatchlistItem, WatchStatus, MediaType } from '@/types';

function docToItem(data: Record<string, unknown>): WatchlistItem {
  const mediaType = data.mediaType as MediaType;
  const { status, dropped } = migrateStatus(data.status as string, mediaType, data.dropped as boolean | undefined);
  return {
    tmdbId: data.tmdbId as number,
    mediaType,
    status,
    rating: (data.rating as number) ?? null,
    notes: (data.notes as string) ?? null,
    title: data.title as string,
    posterPath: (data.posterPath as string) ?? null,
    releaseYear: (data.releaseYear as number) ?? null,
    totalSeasons: (data.totalSeasons as number) ?? null,
    lastWatchedSeason: (data.lastWatchedSeason as number) ?? null,
    lastWatchedEpisode: (data.lastWatchedEpisode as number) ?? null,
    dropped,
    rewatchCount: (data.rewatchCount as number) ?? 0,
    providers: (data.providers as number[]) ?? [],
    genreIds: (data.genreIds as number[]) ?? [],
    tmdbStatus: (data.tmdbStatus as string) ?? null,
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
  updateTmdbStatus: (tmdbId: number, tmdbStatus: string | null) => Promise<void>;
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
  updateTmdbStatus: async () => {},
  removeItem: async () => {},
  getByStatus: () => [],
  getItem: () => null,
});

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { uid, user } = useAuth();
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
    const isFirst = items.length === 0;
    await setDoc(ref, {
      ...item,
      dropped: false,
      // Denormaliserad isPublic så läsregeln för publika profilvisningar
      // slipper göra en get() mot parent-user-doc per item (se 9.3). Användare
      // toggles isPublic i settings → AuthContext.updateIsPublic cascadar nya
      // värdet till alla watchlist-items.
      isPublic: user?.isPublic ?? false,
      addedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      watchedAt: item.status === 'sedd' ? serverTimestamp() : null,
    }, { merge: true });
    trackEvent('title_added_watchlist', { mediaType: item.mediaType, status: item.status });
    if (isFirst) {
      trackEvent('first_title_added', { mediaType: item.mediaType });
    }
  }, [uid, items.length, user?.isPublic]);

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
    // Auto-promote: om användaren markerar första avsnittet sett medan
    // titeln ligger i 'vill_se' så flytta den automatiskt till 'mina' (TV)
    // eller 'sedd' (film). Tar bort manuellt steg "ändra status först".
    // Idempotent — körs bara på vill_se-items.
    const current = items.find(i => i.tmdbId === tmdbId);
    const promoteStatus: WatchStatus | null =
      current?.status === 'vill_se' && season >= 1 && episode >= 1
        ? (current.mediaType === 'tv' ? 'mina' : 'sedd')
        : null;
    await setDoc(ref, {
      lastWatchedSeason: season,
      lastWatchedEpisode: episode,
      updatedAt: serverTimestamp(),
      ...(promoteStatus ? { status: promoteStatus, watchedAt: promoteStatus === 'sedd' ? serverTimestamp() : null } : {}),
    }, { merge: true });
  }, [uid, items]);

  const updateTmdbStatus = useCallback(async (tmdbId: number, tmdbStatus: string | null) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    await setDoc(ref, { tmdbStatus, updatedAt: serverTimestamp() }, { merge: true });
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

  const value = useMemo(() => ({
    items, addItem, updateStatus, updateRating, updateNotes, updateProgress, updateTmdbStatus, removeItem, getByStatus, getItem,
  }), [items, addItem, updateStatus, updateRating, updateNotes, updateProgress, updateTmdbStatus, removeItem, getByStatus, getItem]);

  return (
    <WatchlistContext.Provider value={value}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  return useContext(WatchlistContext);
}
