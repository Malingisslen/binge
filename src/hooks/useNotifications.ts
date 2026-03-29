'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { collection, doc, getDoc, onSnapshot, setDoc, writeBatch, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { toDate } from '@/lib/firebase/utils';
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

export function useNotifications() {
  const { uid, user } = useAuth();
  const { items } = useWatchlist();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const checkedRef = useRef(false);

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

  // Check for new availability once per session
  useEffect(() => {
    if (!uid || !user || checkedRef.current) return;
    const myProviders = user.myProviders ?? [];
    if (myProviders.length === 0) return;

    const candidates = items.filter(i =>
      i.status === 'följer' && !i.dropped &&
      !(i.providers ?? []).some(p => myProviders.includes(p))
    );
    if (candidates.length === 0) return;

    checkedRef.current = true;

    Promise.all(
      candidates.slice(0, 10).map(async item => {
        try {
          const data = await getWatchProviders(item.mediaType, item.tmdbId);
          const flatrate = data.results?.SE?.flatrate ?? [];
          const match = flatrate.find(p => myProviders.includes(p.provider_id));
          if (match) {
            const notifId = `${item.tmdbId}-${match.provider_id}`;
            const notifRef = doc(db, 'users', uid, 'notifications', notifId);
            const existing = await getDoc(notifRef);
            if (!existing.exists()) {
              await setDoc(notifRef, {
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
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, user?.myProviders?.join(','), items.length]);

  const markRead = useCallback(async (notifId: string) => {
    if (!uid) return;
    await setDoc(doc(db, 'users', uid, 'notifications', notifId), { read: true }, { merge: true });
  }, [uid]);

  const markAllRead = useCallback(async () => {
    if (!uid) return;
    const unread = notifications.filter(n => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach(n => batch.update(doc(db, 'users', uid, 'notifications', n.id), { read: true }));
    await batch.commit();
  }, [uid, notifications]);

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  return { notifications, unreadCount, markRead, markAllRead };
}
