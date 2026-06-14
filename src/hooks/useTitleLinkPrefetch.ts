'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseTitleHref, titlePrefetchSpec } from '@/lib/tmdb/prefetch';

// ~150 ms hover innan vi tror på "intent" — sveps-förbi-länkar filtreras bort.
const HOVER_INTENT_MS = 150;

// Data-sparläge → hoppa prefetch helt (snäll mot mätabonnemang).
function saveDataOn(): boolean {
  try {
    const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    return c?.saveData === true;
  } catch {
    return false;
  }
}

/**
 * Global, delegerad prefetch-på-intent för ALLA titellänkar (/movie/:id, /tv/:id)
 * i appen — oavsett vilken komponent som ritar länken. Monteras EN gång (AppShell).
 *
 * - pointerover: starta 150 ms hover-intent-timer för länken; byter man länk
 *   eller lämnar den nollställs timern. Efter 150 ms → prefetcha.
 * - pointerdown: prefetcha direkt (touch/klick = omedelbar intent).
 * - focusin: prefetcha direkt (tangentbordsnavigation = intent).
 *
 * Prefetchen träffar SAMMA queryKey som detaljsidan (titlePrefetchSpec), dedupas
 * av staleTime och stryps av TMDB-klientens 8-concurrent-semafor. Bara TMDB,
 * ingen Firestore. Hoppas helt i data-sparläge.
 */
export function useTitleLinkPrefetch(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingPath: string | null = null;

    const clearTimer = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      pendingPath = null;
    };

    const prefetchPath = (path: string) => {
      const parsed = parseTitleHref(path);
      if (!parsed) return;
      void queryClient.prefetchQuery(titlePrefetchSpec(parsed.mediaType, parsed.id));
    };

    // Returnerar länkens pathname om target ligger i ett <a> till en titel.
    const titlePathOf = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const a = target.closest('a');
      if (!(a instanceof HTMLAnchorElement)) return null;
      return parseTitleHref(a.pathname) ? a.pathname : null;
    };

    const onPointerOver = (e: Event) => {
      if (saveDataOn()) return;
      const path = titlePathOf(e.target);
      if (!path) { clearTimer(); return; }
      if (path === pendingPath) return; // redan på väg för denna länk
      clearTimer();
      pendingPath = path;
      timer = setTimeout(() => {
        const p = pendingPath;
        clearTimer();
        if (p) prefetchPath(p);
      }, HOVER_INTENT_MS);
    };

    const onIntentNow = (e: Event) => {
      if (saveDataOn()) return;
      const path = titlePathOf(e.target);
      if (path) prefetchPath(path);
    };

    document.addEventListener('pointerover', onPointerOver, { passive: true });
    document.addEventListener('pointerdown', onIntentNow, { passive: true });
    document.addEventListener('focusin', onIntentNow);

    return () => {
      clearTimer();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerdown', onIntentNow);
      document.removeEventListener('focusin', onIntentNow);
    };
  }, [queryClient]);
}
