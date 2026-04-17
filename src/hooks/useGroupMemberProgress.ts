'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

export interface MemberProgress {
  lastWatchedSeason: number | null;
  lastWatchedEpisode: number | null;
  status: string | null;
}

// Fas 2-uppföljning: TV-asymmetri per rad.
//
// Vi läser varje medlems watchlist (samma publika läs-regel som
// usePublicWatchlist) och bygger en Map<uid, Map<tmdbId, MemberProgress>>.
// Medlemmar med privat profil blockeras av Firestore-regeln — de får
// tomma maps. UI visar "—" för dem.
export function useGroupMemberProgress(memberUids: string[]): Map<string, Map<number, MemberProgress>> {
  const results = useQueries({
    queries: memberUids.map(uid => ({
      queryKey: ['member-progress', uid],
      queryFn: async (): Promise<Map<number, MemberProgress>> => {
        try {
          const snap = await getDocs(collection(db, 'users', uid, 'watchlist'));
          const map = new Map<number, MemberProgress>();
          for (const d of snap.docs) {
            const data = d.data();
            const tmdbId = data.tmdbId as number;
            if (!tmdbId) continue;
            map.set(tmdbId, {
              lastWatchedSeason: (data.lastWatchedSeason as number) ?? null,
              lastWatchedEpisode: (data.lastWatchedEpisode as number) ?? null,
              status: (data.status as string) ?? null,
            });
          }
          return map;
        } catch {
          return new Map();
        }
      },
      staleTime: 5 * 60_000,
    })),
  });

  return useMemo(() => {
    const outer = new Map<string, Map<number, MemberProgress>>();
    memberUids.forEach((uid, i) => {
      outer.set(uid, results[i].data ?? new Map());
    });
    return outer;
  }, [memberUids, results]);
}
