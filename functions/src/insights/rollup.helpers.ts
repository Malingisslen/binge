// Pure helpers for the insights rollup — NO firebase-admin import, so they
// unit-test under the ROOT vitest toolchain (firebase-admin is a functions-only
// dependency; importing it from a test breaks CI's clean root install). Same
// extract-pure-logic split as the other functions *.helpers/logic files.
// rollup.ts imports these for use in the scheduled function.

import type { RollupData, MediaType } from './types';

// Alias→canonical provider map, mirrored from SWEDISH_PROVIDERS in
// src/lib/tmdb/providers.ts (functions can't import @/ aliases). KEEP IN SYNC
// with that file AND the sibling copy in availableNotify/logic.ts. TMDB lists
// one service under several ids (e.g. Max = 384 + legacy 1899 + Amazon-channel
// 1825); watchlist docs written before the client canonicalised on write still
// hold the raw alias ids, so the rollup must fold them together before ranking —
// otherwise "Max" splits into three rows in the topProviders panel.
const ALIAS_TO_CANONICAL: Record<number, number> = {
  1899: 384, 1825: 384,   // Max
  493: 520,               // SVT Play
  1944: 489, 1759: 489,   // TV4 Play
  2243: 350,              // Apple TV+
  1968: 323, 283: 323,    // Crunchyroll
  1773: 431, 531: 431,    // SkyShowtime (531 = nedlagda Paramount+)
  188: 335,               // YouTube Premium
  497: 521,               // Tele2 Play
  517: 578,               // TriArt Play
};

/** Fold TMDB's alias ids onto the canonical service id (identity for base ids). */
export function canonicalProviderId(id: number): number {
  return ALIAS_TO_CANONICAL[id] ?? id;
}

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
