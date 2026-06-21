'use client';

import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';

// BIN-104: read the public per-title community-rating aggregate
// (titleRatingsAggregate/{mediaType}_{tmdbId} = {count, sum}). One cached doc
// read per title page — avg computed on read. Maintained server-side by the
// communityRatingMaintain trigger.
export interface CommunityRating { count: number; avg: number }

export function useCommunityRating(mediaType: 'movie' | 'tv', tmdbId: number | undefined) {
  const { data } = useQuery({
    queryKey: ['community-rating', mediaType, tmdbId],
    enabled: !!tmdbId,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<CommunityRating | null> => {
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'titleRatingsAggregate', `${mediaType}_${tmdbId}`));
      if (!snap.exists()) return null;
      const d = snap.data();
      const count = typeof d.count === 'number' ? d.count : 0;
      const sum = typeof d.sum === 'number' ? d.sum : 0;
      if (count <= 0) return null;
      return { count, avg: sum / count };
    },
  });
  return data ?? null;
}
