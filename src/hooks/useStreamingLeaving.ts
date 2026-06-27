'use client';

import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';

/** One title leaving a service (BIN-178). Mirrors functions/leavingRollup/logic. */
export interface LeavingEntry {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  leaving: string; // YYYY-MM-DD
}

/**
 * Read the shared streamingLeaving/current rollup (one doc, all providers) and
 * slice it to one provider. Query key NOT persisted — it's small but catalog-
 * scoped and refreshes daily server-side, so a 1h client cache is enough.
 */
export function useStreamingLeaving(providerId: number | undefined): { entries: LeavingEntry[]; loading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['streaming-leaving'],
    staleTime: 1000 * 60 * 60, // 1h
    queryFn: async () => {
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'streamingLeaving', 'current'));
      const byProvider = snap.exists() ? snap.data()?.byProvider : undefined;
      return (byProvider ?? {}) as Record<string, LeavingEntry[]>;
    },
  });
  const entries = providerId != null ? (data?.[String(providerId)] ?? []) : [];
  return { entries, loading: isLoading };
}
