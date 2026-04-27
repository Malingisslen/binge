'use client';

import { useQuery } from '@tanstack/react-query';
import { doc, getDoc, getDocs, collection, query, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { toDate } from '@/lib/firebase/utils';
import { migrateStatus } from '@/lib/watchStatus.migration';
import type { UserProfile, WatchlistItem, MediaType } from '@/types';

// Tre möjliga resultat:
// - null                                      → username-doc finns inte (verkligen ej användare)
// - { uid, username, isPrivate: true }        → finns men profil ej läsbar (rules avvisar pga visibility-tier)
// - { uid, profile }                          → publik/vän-läsbar profil
//
// usernames-collection är public-read så vi kan alltid skilja "okänd
// användare" från "privat profil" — bättre UX-feedback.
export type PublicProfileResult =
  | null
  | { uid: string; username: string; isPrivate: true }
  | { uid: string; profile: UserProfile };

export function usePublicProfile(username: string) {
  return useQuery<PublicProfileResult>({
    queryKey: ['public-profile', username],
    queryFn: async () => {
      const usernameSnap = await getDoc(doc(db, 'usernames', username));
      if (!usernameSnap.exists()) return null;
      const uid = usernameSnap.data().uid as string;
      try {
        const profileSnap = await getDoc(doc(db, 'users', uid));
        if (!profileSnap.exists()) {
          // Edge: username-doc finns men user-doc raderad. Behandla som privat
          // (kan inte läsa) snarare än "ej användare" (det skulle vara felaktigt).
          return { uid, username, isPrivate: true };
        }
        const data = profileSnap.data();
        return {
          uid,
          profile: {
            displayName: data.displayName ?? '',
            email: '',
            photoURL: data.photoURL ?? null,
            username: data.username ?? null,
            bio: data.bio ?? '',
            defaultVisibility: data.defaultVisibility ?? (data.isPublic ? 'public' : 'private'),
            isPublic: data.isPublic ?? false,
            myProviders: data.myProviders ?? [],
            defaultView: data.defaultView ?? 'table',
            hideNonLatinTitles: data.hideNonLatinTitles ?? false,
            hiddenCountries: data.hiddenCountries ?? [],
            providerCosts: {},
            providerTiers: {},
            providerPauses: {},
            calibrationGenres: null,
            createdAt: toDate(data.createdAt),
            updatedAt: toDate(data.updatedAt),
            notificationSettings: { newEpisodes: false, availableOnMyServices: false },
          } as UserProfile,
        };
      } catch {
        // Firestore-rules avvisade läsning — profil är private/friends och
        // jag är inte tillåten. Visa "den här profilen är privat" istället
        // för det vilseledande "användaren hittades inte".
        return { uid, username, isPrivate: true };
      }
    },
    staleTime: 60_000,
  });
}

// Power-user med 2000+ titlar skulle annars kosta 2000 Firestore-reads per
// profilvisning. 500 är taket för vad vi renderar på en offentlig profil —
// behöver användaren se mer får det bli via filterar/sök senare.
const PUBLIC_WATCHLIST_LIMIT = 500;

export function usePublicWatchlist(uid: string | null) {
  return useQuery({
    queryKey: ['public-watchlist', uid],
    queryFn: async () => {
      const q = query(collection(db, 'users', uid!, 'watchlist'), limit(PUBLIC_WATCHLIST_LIMIT));
      const snap = await getDocs(q);
      return snap.docs.map(d => {
        const data = d.data();
        const mediaType = data.mediaType as MediaType;
        // Använd shared migration så publik profil ser samma statusar som
        // ägaren — annars skulle vänner se 'följer' badge medan ägaren ser
        // 'mina' i sin egen vy.
        const { status, dropped } = migrateStatus(
          data.status as string,
          mediaType,
          data.dropped as boolean | undefined,
        );
        return {
          tmdbId: data.tmdbId as number,
          mediaType,
          status,
          rating: (data.rating as number) ?? null,
          notes: null,
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
