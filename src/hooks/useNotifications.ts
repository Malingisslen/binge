'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { collection, doc, getDoc, onSnapshot, setDoc, writeBatch, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/lib/firebase/config';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useFriendRequests } from '@/hooks/useFriends';
import { getRecentSessionPicksAcrossGroups } from '@/lib/firebase/groups';
import { getWatchProviders } from '@/lib/tmdb/client';
import { canonicalProviderId } from '@/lib/tmdb/providers';

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

export interface RecentGroupPick {
  groupId: string;
  groupName: string;
  sessionId: string;
  pickedTmdbId: number;
  mediaType: 'movie' | 'tv';
  mediaTitle: string;
  posterPath: string | null;
  pickedAt: Date;
}

export function useNotifications() {
  const { uid, user } = useAuth();
  const { items } = useWatchlist();
  const { data: friendRequests = [] } = useFriendRequests();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const checkedRef = useRef(false);

  // Subscribera på provider-availability-notifs (legacy).
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

  // Recent group session picks — hämtas via getRecentSessionPicksAcrossGroups.
  // "since" = lastNotificationsSeenAt (eller user.createdAt om legacy-konto).
  // 30s staleTime — picks är sällsynta så vi behöver inte poll:a hårt.
  const since = useMemo(() => {
    return user?.lastNotificationsSeenAt ?? user?.createdAt ?? new Date(0);
  }, [user?.lastNotificationsSeenAt, user?.createdAt]);
  const { data: recentPicks = [] } = useQuery<RecentGroupPick[]>({
    queryKey: ['recent-group-picks', uid, since.getTime()],
    queryFn: () => uid ? getRecentSessionPicksAcrossGroups(uid, since, 10) : Promise.resolve([]),
    enabled: !!uid,
    staleTime: 30_000,
  });

  // Check for new availability once per session
  useEffect(() => {
    if (!uid || !user || checkedRef.current) return;
    const myProviders = user.myProviders ?? [];
    if (myProviders.length === 0) return;

    const candidates = items.filter(i =>
      i.status === 'mina' && i.mediaType === 'tv' && !i.dropped &&
      !(i.providers ?? []).some(p => myProviders.includes(canonicalProviderId(p)))
    );
    if (candidates.length === 0) return;

    checkedRef.current = true;

    Promise.all(
      candidates.slice(0, 10).map(async item => {
        try {
          const data = await getWatchProviders(item.mediaType, item.tmdbId);
          const flatrate = data.results?.SE?.flatrate ?? [];
          const match = flatrate.find(p => myProviders.includes(canonicalProviderId(p.provider_id)));
          if (match) {
            const canonicalId = canonicalProviderId(match.provider_id);
            const notifId = `${item.tmdbId}-${canonicalId}`;
            const notifRef = doc(db, 'users', uid, 'notifications', notifId);
            const existing = await getDoc(notifRef);
            if (!existing.exists()) {
              await setDoc(notifRef, {
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                title: item.title,
                providerId: canonicalId,
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

  // Sammansatt unread-räkning för bell-badge:n. Friend requests är action-
  // required (måste accepteras/avböjas) → räknas alltid. Recent picks +
  // provider-availability räknas tills användaren öppnar dropdown:n.
  const friendRequestsCount = friendRequests.length;
  const providerUnreadCount = notifications.filter(n => !n.read).length;
  const recentPicksCount = recentPicks.length;
  const unreadCount = friendRequestsCount + providerUnreadCount + recentPicksCount;

  return {
    notifications,
    friendRequests,
    recentPicks,
    unreadCount,
    friendRequestsCount,
    providerUnreadCount,
    recentPicksCount,
    markRead,
    markAllRead,
  };
}
