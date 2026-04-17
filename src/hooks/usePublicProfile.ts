'use client';

import { useQuery } from '@tanstack/react-query';
import { doc, getDoc, getDocs, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { toDate } from '@/lib/firebase/utils';
import type { UserProfile, WatchlistItem, WatchStatus, MediaType } from '@/types';

export function usePublicProfile(username: string) {
  return useQuery({
    queryKey: ['public-profile', username],
    queryFn: async () => {
      const usernameSnap = await getDoc(doc(db, 'usernames', username));
      if (!usernameSnap.exists()) return null;
      const uid = usernameSnap.data().uid as string;
      const profileSnap = await getDoc(doc(db, 'users', uid));
      if (!profileSnap.exists()) return null;
      const data = profileSnap.data();
      return {
        uid,
        profile: {
          displayName: data.displayName ?? '',
          email: '',
          photoURL: data.photoURL ?? null,
          username: data.username ?? null,
          bio: data.bio ?? '',
          isPublic: data.isPublic ?? false,
          myProviders: data.myProviders ?? [],
          defaultView: data.defaultView ?? 'table',
          providerCosts: {},
          createdAt: toDate(data.createdAt),
          updatedAt: toDate(data.updatedAt),
          notificationSettings: { newEpisodes: false, availableOnMyServices: false },
        } as UserProfile,
      };
    },
    staleTime: 60_000,
  });
}

export function usePublicWatchlist(uid: string | null) {
  return useQuery({
    queryKey: ['public-watchlist', uid],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'users', uid!, 'watchlist'));
      return snap.docs.map(d => {
        const data = d.data();
        return {
          tmdbId: data.tmdbId as number,
          mediaType: data.mediaType as MediaType,
          status: (data.status === 'watching' ? 'följer' : data.status === 'want_to_watch' ? 'vill_se' : data.status === 'watched' ? 'sedd' : data.status) as WatchStatus,
          rating: (data.rating as number) ?? null,
          notes: null,
          title: data.title as string,
          posterPath: (data.posterPath as string) ?? null,
          releaseYear: (data.releaseYear as number) ?? null,
          totalSeasons: (data.totalSeasons as number) ?? null,
          lastWatchedSeason: (data.lastWatchedSeason as number) ?? null,
          lastWatchedEpisode: (data.lastWatchedEpisode as number) ?? null,
          dropped: (data.dropped as boolean) ?? false,
          rewatchCount: (data.rewatchCount as number) ?? 0,
          providers: (data.providers as number[]) ?? [],
          genreIds: (data.genreIds as number[]) ?? [],
          addedAt: toDate(data.addedAt),
          updatedAt: toDate(data.updatedAt),
          watchedAt: data.watchedAt ? toDate(data.watchedAt) : null,
        } as WatchlistItem;
      });
    },
    enabled: uid !== null,
    staleTime: 60_000,
  });
}
