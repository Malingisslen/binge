'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { discoverTV } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { useWatchlist } from './useWatchlist';
import { useNotInterested } from '@/contexts/NotInterestedContext';
import {
  selectDiscoveryPremieres,
  type PremiereWindow,
  type DiscoveryPremiere,
} from '@/lib/calendar/premieres';

// Upptäckt: stora kommande NYA seriepremiärer (S1) i fönstret som du inte redan
// följer/avfärdat. Två discover-sidor räcker för en topp-12; queryKey-huvudet
// 'discover-tv' är i persist-vitlistan (queryClient.ts) så det persisteras
// lagligt som en liten delad katalog-query — inte per-titel-data.
//
// Fas 1 = bara nya serier (S1). Återkommande säsongers premiärer (trending
// serier med next_episode_to_air S≥2 E1) är en dokumenterad Fas 2 → egen ticket.

const PAGES = [1, 2] as const;

export interface DiscoveryPremieresResult {
  premieres: DiscoveryPremiere[];
  isLoading: boolean;
}

export function useDiscoveryPremieres(window: PremiereWindow): DiscoveryPremieresResult {
  const { items } = useWatchlist();
  const { items: notInterested, loading: notInterestedLoading } = useNotInterested();

  const queries = useQueries({
    queries: PAGES.map(page => ({
      queryKey: ['discover-tv', 'premiere-window', window.startIso, page] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        discoverTV({
          'first_air_date.gte': window.startIso,
          'first_air_date.lte': window.endIso,
          sort_by: 'popularity.desc',
          ...(page > 1 ? { page: String(page) } : {}),
        }, { signal }),
      staleTime: TMDB_STALE.DISCOVER,
    })),
  });

  const anyPending = queries.some(q => q.isPending);

  const results = useMemo(
    () => queries.flatMap(q => q.data?.results ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries.map(q => q.dataUpdatedAt).join(',')],
  );

  // Exkludera allt i biblioteket (vilken status som helst — bibliotekstitlar ska
  // aldrig dyka upp som "upptäck") plus avfärdade titlar.
  const excludedIds = useMemo(() => {
    const set = new Set<number>();
    for (const it of items) if (it.mediaType === 'tv') set.add(it.tmdbId);
    for (const ni of notInterested) set.add(ni.tmdbId);
    return set;
  }, [items, notInterested]);

  const premieres = useMemo(
    () => selectDiscoveryPremieres(results, excludedIds, window),
    [results, excludedIds, window],
  );

  // Gate:a på notInterested-laddning så avfärdade titlar inte blinkar in på
  // kall laddning (BIN-37).
  const isLoading = anyPending || notInterestedLoading;

  return { premieres, isLoading };
}
