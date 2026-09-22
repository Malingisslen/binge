'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useFriendRequests } from '@/hooks/useFriends';
import { getRecentSessionPicksAcrossGroups } from '@/lib/firebase/groups';
import { captureError } from '@/lib/sentry';
import { markOneRead, markManyRead } from './useNotifications.helpers';

export interface AppNotification {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  // Diskriminator: legacy provider-availability-notifs saknar `kind` och
  // defaultas till 'provider_available'. Episod-release-notifs (Fas 6) sätter
  // 'episode_release' + episodeCode och saknar provider-fälten. 'digital_release'
  // (BIN-360) är film-analogen — en "släpps idag"-push på svenskt digitalt
  // släppdatum; tmdbId-formad (movie), inga provider-/episod-fält. Veckodigest
  // (BIN-163) sätter 'weekly_digest' + summary/digestItems och är INTE
  // tmdbId-formad (tmdbId=0) — en rollup över flera titlar. 'system' är en notis
  // som inte handlar om en titel — INTE tmdbId-formad; bär `body`, och
  // `actionUrl` när det finns något att öppna.
  kind: 'provider_available' | 'episode_release' | 'digital_release' | 'weekly_digest' | 'system';
  providerId: number | null;
  providerName: string | null;
  episodeCode: string | null;
  // 'system'-fält (undefined för övriga kinds).
  body?: string;
  actionUrl?: string;
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
        if (data.kind === 'system') {
          // En notis som inte handlar om en titel. Inte tmdbId-formad. Utan denna gren coerce:ades den till 'provider_available'
          // och byggde en trasig /tv/undefined-länk (Sentry BINGE-9). `actionUrl`
          // är valfri — ett kort utan den har ingen sida läsaren får öppna, och
          // `TopbarActions` renderar det som en rad i stället för en länk.
          return {
            id: d.id,
            tmdbId: 0,
            mediaType: 'movie',
            title: data.title ?? 'Systemnotis',
            kind: 'system',
            providerId: null,
            providerName: null,
            episodeCode: null,
            body: data.body ?? '',
            actionUrl: typeof data.actionUrl === 'string' ? data.actionUrl : undefined,
            read: data.read ?? false,
            createdAt: toDate(data.createdAt),
          } as AppNotification;
        }
        return {
          id: d.id,
          tmdbId: data.tmdbId,
          mediaType: data.mediaType,
          title: data.title,
          kind: data.kind === 'episode_release' ? 'episode_release'
            : data.kind === 'digital_release' ? 'digital_release'
            : 'provider_available',
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

  const reportWriteFailure = useCallback((error: unknown, kind: string) => {
    captureError(error, { scope: 'notifications', kind });
  }, []);

  // BIN-1170: updateDoc, inte setDoc+merge — en merge mot ett dokument som hunnit
  // raderas utvarderas som CREATE av reglerna, och notis-grenen nekar create
  // (notiser skrivs bara av Cloud Functions). Vad som rapporteras och varfor
  // skrivningarna gar en och en star i useNotifications.helpers.ts.
  const writeRead = useCallback(async (notifId: string) => {
    const { db, doc, updateDoc } = await fsdb();
    return updateDoc(doc(db, 'users', uid!, 'notifications', notifId), { read: true });
  }, [uid]);

  const markRead = useCallback(async (notifId: string) => {
    if (!uid) return;
    await markOneRead(writeRead, notifId, reportWriteFailure);
  }, [uid, writeRead, reportWriteFailure]);

  const markAllRead = useCallback(async () => {
    if (!uid) return;
    const unread = notifications.filter(n => !n.read);
    if (unread.length === 0) return;
    await markManyRead(writeRead, unread.map(n => n.id), reportWriteFailure);
  }, [uid, notifications, writeRead, reportWriteFailure]);

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
