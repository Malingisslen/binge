'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, doc, onSnapshot, setDoc, updateDoc, getDocs, query, where, orderBy, limit, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/contexts/AuthContext';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getWatchProviders } from '@/lib/tmdb/client';

export interface AppNotification {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  providerId: number;
  providerName: string;
  read: boolean;
  createdAt: Date;
}

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  return new Date();
}

export function useNotifications() {
  const { uid, user } = useAuth();
  const { items } = useWatchlist();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [checking, setChecking] = useState(false);

  // Listen for notifications
  useEffect(() => {
    if (!uid) { setNotifications([]); return; }
    const q = query(
      collection(db, 'users', uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          tmdbId: data.tmdbId,
          mediaType: data.mediaType,
          title: data.title,
          providerId: data.providerId,
          providerName: data.providerName,
          read: data.read ?? false,
          createdAt: toDate(data.createdAt),
        } as AppNotification;
      }));
    });
    return () => unsub();
  }, [uid]);

  // Check for new availability on app load (once per session)
  useEffect(() => {
    if (!uid || !user || checking) return;
    const myProviders = user.myProviders ?? [];
    if (myProviders.length === 0) return;

    // Only check items in 'följer' that don't already have providers matching user's services
    const candidates = items.filter(i =>
      i.status === 'följer' && !i.dropped &&
      !(i.providers ?? []).some(p => myProviders.includes(p))
    );

    if (candidates.length === 0) return;

    setChecking(true);

    // Check up to 10 candidates per session to avoid rate limiting
    const toCheck = candidates.slice(0, 10);

    Promise.all(
      toCheck.map(async item => {
        try {
          const data = await getWatchProviders(item.mediaType, item.tmdbId);
          const seProviders = data.results?.SE;
          const flatrate = seProviders?.flatrate ?? [];
          const match = flatrate.find(p => myProviders.includes(p.provider_id));
          if (match) {
            // Check if we already sent this notification
            const existing = await getDocs(query(
              collection(db, 'users', uid, 'notifications'),
              where('tmdbId', '==', item.tmdbId),
              where('providerId', '==', match.provider_id),
              limit(1)
            ));
            if (existing.empty) {
              const notifId = `${item.tmdbId}-${match.provider_id}`;
              await setDoc(doc(db, 'users', uid, 'notifications', notifId), {
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                title: item.title,
                providerId: match.provider_id,
                providerName: match.provider_name,
                read: false,
                createdAt: serverTimestamp(),
              });
            }
          }
        } catch {
          // Silently skip failed checks
        }
      })
    ).finally(() => setChecking(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, user?.myProviders?.length, items.length]);

  const markRead = useCallback(async (notifId: string) => {
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'notifications', notifId), { read: true });
  }, [uid]);

  const markAllRead = useCallback(async () => {
    if (!uid) return;
    await Promise.all(
      notifications.filter(n => !n.read).map(n =>
        updateDoc(doc(db, 'users', uid, 'notifications', n.id), { read: true })
      )
    );
  }, [uid, notifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  return { notifications, unreadCount, markRead, markAllRead };
}
