import type { TMDBSearchResponse, TMDBSearchResult } from '@/types';

// TMDB refuses page numbers above 500 whatever total_pages says.
export const TMDB_MAX_PAGE = 500;

/** The next page number, or undefined when the last page is loaded. */
export function nextSearchPage(last: Pick<TMDBSearchResponse, 'page' | 'total_pages'>): number | undefined {
  const lastAvailable = Math.min(last.total_pages, TMDB_MAX_PAGE);
  return last.page < lastAvailable ? last.page + 1 : undefined;
}

/**
 * Results of every loaded page in order. TMDB's ranking can shift between
 * requests, so the same title may reappear on a later page; keeping the first
 * occurrence stops duplicate rows (and duplicate React keys).
 */
export function mergeSearchPages(pages: readonly Pick<TMDBSearchResponse, 'results'>[]): TMDBSearchResult[] {
  const seen = new Set<string>();
  const merged: TMDBSearchResult[] = [];
  for (const page of pages) {
    for (const item of page.results) {
      const key = `${item.media_type}-${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}
