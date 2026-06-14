'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { titlePrefetchSpec } from '@/lib/tmdb/prefetch';
import type { MediaType } from '@/types';

// ~150 ms hover innan vi tror på "intent" — filtrerar bort titlar som bara
// sveps förbi med muspekaren, så vi inte prefetchar hela griden.
const HOVER_INTENT_MS = 150;

/**
 * Ger prefetch-handlers åt ett titelkort. På desktop: hovra i ~150 ms →
 * prefetcha titelns detalj (samma queryKey som detaljsidan, dedupas av
 * staleTime). Lämnar man kortet före dess avbryts timern. Allt fire-and-forget;
 * kostar bara ett TMDB-anrop som ändå skulle skett på klick.
 */
export function usePrefetchTitle() {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback((mediaType: MediaType, id: number) => {
    void queryClient.prefetchQuery(titlePrefetchSpec(mediaType, id));
  }, [queryClient]);

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  // Rensa en hängande timer om kortet unmountar mitt i hover-intent-fönstret.
  useEffect(() => cancel, [cancel]);

  const onPointerEnter = useCallback((mediaType: MediaType, id: number) => {
    cancel();
    timer.current = setTimeout(() => fire(mediaType, id), HOVER_INTENT_MS);
  }, [cancel, fire]);

  return { onPointerEnter, onPointerLeave: cancel, onPointerDown: fire, fire };
}
