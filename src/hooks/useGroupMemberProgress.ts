'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

export interface MemberProgress {
  lastWatchedSeason: number | null;
  lastWatchedEpisode: number | null;
  status: string | null;
}

// Per-medlem progress läses nu från GRUPPENS egna subcollection
// (groups/{id}/watchlist/{tmdbId}/progress/{uid}) istället för medlemmars
// personliga watchlist-items. Detta isolerar gruppvyn från personlig
// visibility — en medlem med defaultVisibility='private' kan ändå dela sin
// progress till grupper hen är medlem i, eftersom grupp-progress lever i
// en collection som styrs av gruppmedlemskap snarare än profil-publik.
//
// Sync sker via WatchlistContext.updateProgress → syncProgressToGroups()
// som skriver till alla mina grupper där titeln finns.
export function useGroupMemberProgress(groupId: string): Map<string, Map<number, MemberProgress>> {
  const { data } = useQuery({
    queryKey: ['group-member-progress', groupId],
    queryFn: async (): Promise<Map<string, Map<number, MemberProgress>>> => {
      const outer = new Map<string, Map<number, MemberProgress>>();
      try {
        // Hämta alla titlar i gruppens watchlist; för varje titel hämta
        // progress-subcollection. Två lager getDocs är dyrt om gruppen har
        // 100+ titlar, men i praktiken har grupper 5-30 titlar. Den riktiga
        // N+1-fixen vore collectionGroup('progress') med where('groupId'), men
        // det kräver ett extra groupId-fält på varje progress-doc + ett
        // composite-index (extern Firestore-config). Tills det finns lutar vi
        // oss istället på hårdare cache (se staleTime/gcTime nedan) så att de
        // N+1 läsningarna inte upprepas vid varje rendering/navigering.
        const watchlistSnap = await getDocs(collection(db, 'groups', groupId, 'watchlist'));
        await Promise.all(watchlistSnap.docs.map(async itemDoc => {
          const tmdbId = (itemDoc.data().tmdbId as number) ?? Number(itemDoc.id);
          if (!tmdbId) return;
          const progSnap = await getDocs(
            collection(db, 'groups', groupId, 'watchlist', String(tmdbId), 'progress'),
          );
          for (const p of progSnap.docs) {
            const uid = p.id;
            const inner = outer.get(uid) ?? new Map<number, MemberProgress>();
            const data = p.data();
            inner.set(tmdbId, {
              lastWatchedSeason: (data.lastWatchedSeason as number) ?? null,
              lastWatchedEpisode: (data.lastWatchedEpisode as number) ?? null,
              status: (data.status as string) ?? null,
            });
            outer.set(uid, inner);
          }
        }));
      } catch (err) {
        console.warn('[group-member-progress]', err);
      }
      return outer;
    },
    enabled: !!groupId,
    // Cache-fix mot N+1: 60 s staleTime så in-/utnavigering och
    // re-renderingar återanvänder samma resultat istället för att skjuta
    // av watchlist- + progress-läsningarna på nytt. Fortfarande tight nog
    // att fånga andras nya progress hyfsat snabbt. gcTime håller datat i
    // cachen 5 min efter att vyn lämnats så snabb tillbaka-navigering inte
    // betalar för en ny N+1-runda.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  return useMemo(() => data ?? new Map(), [data]);
}
