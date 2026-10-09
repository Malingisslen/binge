'use client';

import { useQuery } from '@tanstack/react-query';
import { getCredits } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { hasNonLatinTitle } from '@/lib/utils/titleFilter';

/**
 * TMDB localises person names in sv-SE credits, and for many Asian actors both
 * `name` and `original_name` come back in the original script, while the en-US
 * credits carry the Latin name. Fetched only when a shown name needs it, so a
 * title page with Latin names makes no extra request.
 */
export function useLatinPersonNames(
  mediaType: 'movie' | 'tv',
  id: number | undefined,
  people: readonly { name: string }[],
): ReadonlyMap<number, string> | undefined {
  const needed = people.some(p => hasNonLatinTitle(p.name));
  const { data } = useQuery({
    queryKey: ['credits-en', mediaType, id],
    queryFn: ({ signal }) => getCredits(mediaType, id!, { signal }, 'en-US'),
    enabled: needed && id != null,
    staleTime: TMDB_STALE.CREDITS,
    select: d => new Map([...d.cast, ...d.crew].map(p => [p.id, p.name] as const)),
  });
  return data;
}
