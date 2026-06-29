// Pure helpers for the insights rollup — NO firebase-admin import, so they
// unit-test under the ROOT vitest toolchain (firebase-admin is a functions-only
// dependency; importing it from a test breaks CI's clean root install). Same
// extract-pure-logic split as the other functions *.helpers/logic files.
// rollup.ts imports these for use in the scheduled function.

import type { RollupData, MediaType } from './types';

export interface WatchlistLite {
  status: string;
  mediaType: string;
  rating: number | null;
  title: string;
  tmdbId: number;
  providers: number[];
  genreIds: number[];
}

/** Top tracked titles, keyed by tmdbId so we can carry the denormalized title. */
export function topTitles(
  items: WatchlistLite[],
  limit: number,
): RollupData['topTitles'] {
  const byId = new Map<number, { tmdbId: number; mediaType: MediaType; title: string; count: number }>();
  for (const it of items) {
    const existing = byId.get(it.tmdbId);
    if (existing) {
      existing.count += 1;
    } else {
      byId.set(it.tmdbId, {
        tmdbId: it.tmdbId,
        mediaType: (it.mediaType === 'tv' ? 'tv' : 'movie') as MediaType,
        title: it.title,
        count: 1,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * Of a set of insights doc-ids, which dated-history docs are older than the
 * retention window and should be deleted. Keeps `daily` and any non-date id,
 * and only flags `YYYY-MM-DD` ids strictly before the cutoff (lexicographic
 * compare is chronological for ISO dates). `todayIso` is yyyy-mm-dd.
 */
export function expiredInsightDocIds(ids: string[], todayIso: string, retentionDays: number): string[] {
  const cutoffMs = Date.parse(`${todayIso}T00:00:00Z`) - retentionDays * 86_400_000;
  const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
  return ids.filter((id) => /^\d{4}-\d{2}-\d{2}$/.test(id) && id < cutoff);
}
