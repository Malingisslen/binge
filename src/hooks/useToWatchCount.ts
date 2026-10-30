'use client';

import { useMemo } from 'react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useBehindShows } from '@/hooks/useBehindShows';
import { buildToWatchRows } from '@/lib/toWatch';

/**
 * How many titles "Nytt för dig" lists, for the nav counter. It only reads the TMDB answers
 * other views already cached, so a counter on every page never starts its own fan-out: until
 * Hem or Nytt för dig has loaded them, series that are behind but not yet known to be count as
 * zero and the number grows when the answers land.
 */
export function useToWatchCount(): number {
  const { items } = useWatchlist();
  const followedTv = useMemo(
    () => items.filter(i => i.mediaType === 'tv' && i.status === 'mina' && !i.dropped),
    [items],
  );
  const { behindIds } = useBehindShows(followedTv, { fetch: false });
  return useMemo(
    () => buildToWatchRows(items, { behindIds, lastSeen: new Map(), newestAired: new Map(), now: new Date() }).length,
    [items, behindIds],
  );
}
