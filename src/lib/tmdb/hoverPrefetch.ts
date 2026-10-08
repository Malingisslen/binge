import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { parseTitleHref, titlePrefetchSpec } from './prefetch';

/**
 * PERF-7: titellänkarnas förhämtning med tak för HOVER. Högst en hover-startad
 * förhämtning är i luften: en ny hover avbryter den förra, men bara om ingen
 * komponent läser den (sidan man redan står på, eller en länk man klickat på).
 * Klick och tangentbordsfokus (`now`) är riktig avsikt — de stryps aldrig och
 * avbryts aldrig, och en hover som följs av ett klick på samma länk räknas som
 * klick. Så fyller ett svep med musen över ett rutnät inte TMDB-semaforen med
 * fulla detaljsvar som ingen öppnar.
 */
export function createTitlePrefetcher(queryClient: QueryClient): {
  hover: (path: string) => void;
  now: (path: string) => void;
} {
  let hoverKey: QueryKey | null = null;

  const sameKey = (a: QueryKey, b: QueryKey) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  const cancelIfUnobserved = (key: QueryKey) => {
    const query = queryClient.getQueryCache().find({ queryKey: key, exact: true });
    if (!query || query.state.fetchStatus !== 'fetching' || query.getObserversCount() > 0) return;
    void queryClient.cancelQueries({ queryKey: key, exact: true });
  };

  const prefetch = (path: string, fromHover: boolean) => {
    const parsed = parseTitleHref(path);
    if (!parsed) return;
    const spec = titlePrefetchSpec(parsed.mediaType, parsed.id);
    if (fromHover) {
      if (hoverKey && !sameKey(hoverKey, spec.queryKey)) cancelIfUnobserved(hoverKey);
      hoverKey = spec.queryKey;
    } else if (hoverKey && sameKey(hoverKey, spec.queryKey)) {
      hoverKey = null;
    }
    void queryClient.prefetchQuery(spec);
  };

  return {
    hover: path => prefetch(path, true),
    now: path => prefetch(path, false),
  };
}
