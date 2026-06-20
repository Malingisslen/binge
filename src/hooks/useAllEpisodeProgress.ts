'use client';

import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import { useAuth } from '@/hooks/useAuth';
import { flattenEpisodeProgress, type WatchedEpisode } from '@/lib/diary';

// BIN-103 — one-shot read of the signed-in user's whole episodeProgress
// collection (all followed shows in a single getDocs round-trip), normalised to
// flat WatchedEpisode records for the diary. React-Query cached so a diary visit
// costs at most one collection read per staleTime — own data, manual page, cheap.
export function useAllEpisodeProgress() {
  const { uid } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['episodeProgress-all', uid],
    enabled: !!uid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<WatchedEpisode[]> => {
      const { db, collection, getDocs } = await fsdb();
      const snap = await getDocs(collection(db, 'users', uid!, 'episodeProgress'));
      return flattenEpisodeProgress(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    },
  });
  return { episodes: data ?? [], episodesLoading: isLoading };
}
