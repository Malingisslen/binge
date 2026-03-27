'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/contexts/AuthContext';
import type { WatchlistItem, WatchStatus, MediaType } from '@/types';

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  return new Date();
}

function docToItem(data: Record<string, unknown>): WatchlistItem {
  return {
    tmdbId: data.tmdbId as number,
    mediaType: data.mediaType as MediaType,
    status: data.status as WatchStatus,
    rating: (data.rating as number) ?? null,
    notes: (data.notes as string) ?? null,
    title: data.title as string,
    posterPath: (data.posterPath as string) ?? null,
    releaseYear: (data.releaseYear as number) ?? null,
    totalSeasons: (data.totalSeasons as number) ?? null,
    lastWatchedSeason: (data.lastWatchedSeason as number) ?? null,
    lastWatchedEpisode: (data.lastWatchedEpisode as number) ?? null,
    providers: (data.providers as number[]) ?? [],
    addedAt: toDate(data.addedAt),
    updatedAt: toDate(data.updatedAt),
    watchedAt: data.watchedAt ? toDate(data.watchedAt) : null,
  };
}

export function useWatchlist() {
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

  const addItem = useCallback(async (item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt'>) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'watchlist', String(item.tmdbId));
    await setDoc(ref, {
      ...item,
      addedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      watchedAt: item.status === 'watched' ? serverTimestamp() : null,
    }, { merge: true });
  }, [uid]);

  const updateStatus = useCallback(async (tmdbId: number, status: WatchStatus) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    await setDoc(ref, {
      status,
      updatedAt: serverTimestamp(),
      ...(status === 'watched' ? { watchedAt: serverTimestamp() } : {}),
    }, { merge: true });
  }, [uid]);

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

  return { items, addItem, updateStatus, updateRating, updateNotes, removeItem, getByStatus, getItem };
}
