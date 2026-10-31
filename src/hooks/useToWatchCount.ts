'use client';

import { useMemo } from 'react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useBehindShows } from '@/hooks/useBehindShows';
import { useToWatchSeen } from '@/hooks/useToWatchSeen';
import { buildToWatchRows } from '@/lib/toWatch';
import { countUnseen } from '@/lib/toWatchSeen';

/**
 * How many titles in "Nytt för dig" Malin has not yet seen there, for the nav counter (an inbox:
 * opening the page zeroes it, later additions raise it again). It only reads the TMDB answers
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
  const { seen } = useToWatchSeen();
  return useMemo(
    () => countUnseen(buildToWatchRows(items, { behindIds, lastSeen: new Map(), newestAired: new Map(), now: new Date() }), seen),
    [items, behindIds, seen],
  );
}
