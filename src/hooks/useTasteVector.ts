'use client';

import { useMemo } from 'react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { usePublicWatchlist } from '@/hooks/usePublicProfile';
import { useAuth } from '@/hooks/useAuth';
import { buildTasteVector, isUsableVector } from '@/lib/taste/vector';
import { matchPercent } from '@/lib/taste/similarity';
import type { TasteVector } from '@/types';

export function useMyTasteVector(): TasteVector {
  const { items } = useWatchlist();
  const { user } = useAuth();
  return useMemo(
    () => buildTasteVector(items, user?.calibrationGenres ?? null),
    [items, user?.calibrationGenres],
  );
}

export function useTasteMatch(targetUid: string | null): {
  percent: number | null;
  mySampleSize: number;
  theirSampleSize: number;
  usable: boolean;
} {
  const me = useMyTasteVector();
  const { data: theirItems } = usePublicWatchlist(targetUid);

  return useMemo(() => {
    const them = buildTasteVector(theirItems ?? []);
    const usable = isUsableVector(me) && isUsableVector(them);
    return {
      percent: usable ? matchPercent(me, them) : null,
      mySampleSize: me.sampleSize,
      theirSampleSize: them.sampleSize,
      usable,
    };
  }, [me, theirItems]);
}
