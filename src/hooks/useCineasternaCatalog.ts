import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';

interface CatalogDoc {
  tmdbIds: number[];
  rental: Record<string, { amount: number; currency: string }>;
}

export function useCineasternaCatalog() {
  const { data } = useQuery({
    queryKey: ['cineasterna-catalog'],
    staleTime: 1000 * 60 * 60 * 24, // catalog refreshes weekly server-side
    queryFn: async (): Promise<CatalogDoc | null> => {
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'cineasternaCatalog', 'current'));
      return snap.exists() ? (snap.data() as CatalogDoc) : null;
    },
  });
  const set = useMemo(() => new Set(data?.tmdbIds ?? []), [data]);
  return {
    has: (tmdbId: number) => set.has(tmdbId),
    rentalFor: (tmdbId: number) => data?.rental?.[String(tmdbId)] ?? null,
  };
}
