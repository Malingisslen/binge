'use client';

import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { PricePoint } from '@/lib/streaming/priceStats';

/**
 * BIN-354: read the shared, global price-history doc for one title (public read,
 * allow read: if true). Sparse points appended write-on-change by the
 * streamingOffersRefresh cron. staleTime is long — price history moves slowly,
 * and this is a per-title fan-out-able read so we keep it cheap.
 *
 * BIN-562: the doc id is `${mediaType}_${tmdbId}`. TMDB movie ids and TV ids are
 * independent namespaces, so movie 123 and TV 123 used to share one price series
 * and clobber each other's points. Docs written before the change keep the bare
 * `${tmdbId}` id; we fall back to those ONCE, and only when the legacy doc's own
 * `mediaType` matches — an ungated fallback would show one title the other's
 * prices, which is the bug being fixed.
 */
export function usePriceHistory(tmdbId: number | undefined, mediaType: 'movie' | 'tv') {
  return useQuery({
    queryKey: ['price-history', mediaType, tmdbId],
    queryFn: async (): Promise<PricePoint[]> => {
      if (tmdbId == null) return []; // enabled-gated; narrows for mediaTypeDocId
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'priceHistory', mediaTypeDocId(mediaType, tmdbId)));
      const hit = snap.exists()
        ? snap
        : await (async () => {
            const legacy = await getDoc(doc(db, 'priceHistory', String(tmdbId)));
            return legacy.exists() && legacy.get('mediaType') === mediaType ? legacy : null;
          })();
      if (!hit) return [];
      const pts = hit.get('points');
      return Array.isArray(pts) ? (pts as PricePoint[]) : [];
    },
    enabled: tmdbId != null,
    staleTime: 60 * 60 * 1000, // 1h
  });
}
