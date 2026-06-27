'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useFriendRequests } from '@/hooks/useFriends';
import { getRecentSessionPicksAcrossGroups } from '@/lib/firebase/groups';

export interface AppNotification {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  // Diskriminator: legacy provider-availability-notifs saknar `kind` och
  // defaultas till 'provider_available'. Episod-release-notifs (Fas 6) sätter
  // 'episode_release' + episodeCode och saknar provider-fälten. Veckodigest
  // (BIN-163) sätter 'weekly_digest' + summary/digestItems och är INTE
  // tmdbId-formad (tmdbId=0) — en rollup över flera titlar.
  kind: 'provider_available' | 'episode_release' | 'weekly_digest';
  providerId: number | null;
  providerName: string | null;
  episodeCode: string | null;
  // BIN-163 weekly_digest-fält (undefined för övriga kinds).
  summary?: string;
  leavingCount?: number;
  newCount?: number;
  digestItems?: DigestCardItem[];
  read: boolean;
  createdAt: Date;
}

export interface DigestCardItem {
  tmdbId: number;
  title: string;
  mediaType: 'movie' | 'tv';
  leaving: string;
  daysLeft: number;
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
  const { data: friendRequests = [] } = useFriendRequests();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Subscribera på provider-availability-notifs (legacy).
  useEffect(() => {
    if (!uid) { setNotifications([]); return; }
    return lazySubscribe(({ db, collection, query, orderBy, limit, onSnapshot }) =>
      onSnapshot(query(
        collection(db, 'users', uid, 'notifications'),
        orderBy('createdAt', 'desc'),
        limit(50)
      ), snap => {
        setNotifications(snap.docs.map(d => {
        const data = d.data();
        if (data.kind === 'weekly_digest') {
          // Rollup-kort (BIN-163): inte tmdbId-formad. summary är rubriken,
          // digestItems listan över titlar som lämnar snart.
          return {
            id: d.id,
            tmdbId: 0,
            mediaType: 'movie',
            title: data.summary ?? 'Din streamingvecka',
            kind: 'weekly_digest',
            providerId: null,
            providerName: null,
            episodeCode: null,
            summary: data.summary ?? '',
            leavingCount: data.leavingCount ?? 0,
            newCount: data.newCount ?? 0,
            digestItems: Array.isArray(data.items) ? (data.items as DigestCardItem[]) : [],
            read: data.read ?? false,
            createdAt: toDate(data.createdAt),
          } as AppNotification;
        }
        return {
          id: d.id,
          tmdbId: data.tmdbId,
          mediaType: data.mediaType,
          title: data.title,
          kind: data.kind === 'episode_release' ? 'episode_release' : 'provider_available',
          providerId: data.providerId ?? null,
          providerName: data.providerName ?? null,
          episodeCode: data.episodeCode ?? null,
          read: data.read ?? false,
          createdAt: toDate(data.createdAt),
        } as AppNotification;
        }));
      }));
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

  // BIN-60: provider-availability detection moved server-side to the
  // `availableNotify` scheduled Function (covers film vill_se + TV mina,
  // transition-based, with push). The old client-side once-per-session poll
  // here is superseded — it only covered TV mina, had no push, and re-fetched
  // watch/providers on every session. The Function writes the same
  // `provider_available` notif shape + `${tmdbId}-${canonicalId}` doc id, so
  // the inbox below renders it unchanged.

  const markRead = useCallback(async (notifId: string) => {
    if (!uid) return;
    const { db, doc, setDoc } = await fsdb();
    await setDoc(doc(db, 'users', uid, 'notifications', notifId), { read: true }, { merge: true });
  }, [uid]);

  const markAllRead = useCallback(async () => {
    if (!uid) return;
    const unread = notifications.filter(n => !n.read);
    if (unread.length === 0) return;
    const { db, doc, writeBatch } = await fsdb();
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
