'use client';

import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import { todayIso } from '@/lib/utils';
import { dropPassed } from '@/hooks/useStreamingLeaving.helpers';

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
export function useStreamingLeaving(providerId: number | undefined): {
  entries: LeavingEntry[];
  loading: boolean;
  error: boolean;
  /** The Stockholm day the rollup was built (yyyy-mm-dd); its window runs from there. */
  today: string | null;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['streaming-leaving'],
    staleTime: 1000 * 60 * 60, // 1h
    queryFn: async () => {
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'streamingLeaving', 'current'));
      const d = snap.exists() ? snap.data() : undefined;
      return {
        byProvider: (d?.byProvider ?? {}) as Record<string, LeavingEntry[]>,
        today: typeof d?.today === 'string' ? d.today : null,
      };
    },
  });
  const all = providerId != null ? (data?.byProvider[String(providerId)] ?? []) : [];
  // Rollupen kan vara några dagar gammal; en titel vars datum passerat är redan borta.
  const entries = dropPassed(all, todayIso());
  return { entries, loading: isLoading, error: isError, today: data?.today ?? null };
}
