'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getDocs, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { buildTasteVector } from '@/lib/taste/vector';
import type { MediaType, SessionParticipant, TasteVector, WatchlistItem, WatchStatus } from '@/types';

// Fas 3 — hämta publika watchlists för inloggade deltagare och beräkna
// smakvektorer. Gäster utan uid utelämnas (inget att räkna på).
export function useSessionTasteVectors(
  participants: SessionParticipant[],
): Map<string, TasteVector> {
  const authed = useMemo(
    () => participants.filter((p): p is SessionParticipant & { uid: string } => !!p.uid),
    [participants],
  );

  const results = useQueries({
    queries: authed.map(p => ({
      queryKey: ['public-watchlist', p.uid],
      queryFn: async (): Promise<WatchlistItem[]> => {
        const snap = await getDocs(collection(db, 'users', p.uid, 'watchlist'));
        return snap.docs.map(d => {
          const data = d.data();
          return {
            tmdbId: data.tmdbId as number,
            mediaType: data.mediaType as MediaType,
            status: data.status as WatchStatus,
            rating: (data.rating as number) ?? null,
            notes: null,
            title: data.title as string,
            posterPath: null,
            releaseYear: null,
            totalSeasons: null,
            lastWatchedSeason: null,
            lastWatchedEpisode: null,
            dropped: (data.dropped as boolean) ?? false,
            rewatchCount: 0,
            providers: [],
            genreIds: (data.genreIds as number[]) ?? [],
            tmdbStatus: null,
            addedAt: new Date(),
            updatedAt: new Date(),
            watchedAt: null,
          };
        });
      },
      staleTime: 5 * 60_000,
    })),
  });

  return useMemo(() => {
    const map = new Map<string, TasteVector>();
    results.forEach((q, idx) => {
      if (q.data) {
        const p = authed[idx];
        map.set(p.id, buildTasteVector(q.data));
      }
    });
    return map;
  }, [results, authed]);
}
