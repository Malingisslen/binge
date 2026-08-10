// Pure helpers for the insights rollup — NO firebase-admin import, so they
// unit-test under the ROOT vitest toolchain (firebase-admin is a functions-only
// dependency; importing it from a test breaks CI's clean root install). Same
// extract-pure-logic split as the other functions *.helpers/logic files.
// rollup.ts imports these for use in the scheduled function.

import type { RollupData, MediaType } from './types';
import { mediaTypeDocId } from '../shared/mediaTypeDocId';

// Alias→canonical provider map, mirrored from SWEDISH_PROVIDERS in
// src/lib/tmdb/providers.ts (functions can't import @/ aliases). KEEP IN SYNC
// with that file AND the sibling copy in availableNotify/logic.ts. TMDB lists
// one service under several ids (e.g. Max = 384 + legacy 1899 + Amazon-channel
// 1825); watchlist docs written before the client canonicalised on write still
// hold the raw alias ids, so the rollup must fold them together before ranking —
// otherwise "Max" splits into three rows in the topProviders panel.
// Exported (frozen) so the root-vitest parity test in
// src/lib/tmdb/providerAliasParity.test.ts can assert this mirror still matches
// SWEDISH_PROVIDERS.aliases and fail CI on any future drift (BIN-420). Frozen so
// an importer can't mutate the shared map and silently corrupt canonicalisation.
export const ALIAS_TO_CANONICAL: Readonly<Record<number, number>> = Object.freeze({
  1899: 384, 1825: 384,   // Max
  493: 520,               // SVT Play
  1944: 489, 1759: 489,   // TV4 Play
  2243: 350,              // Apple TV+
  1968: 323, 283: 323,    // Crunchyroll
  1773: 431, 531: 431,    // SkyShowtime (531 = nedlagda Paramount+)
  188: 335,               // YouTube Premium
  497: 521,               // Tele2 Play
  517: 578,               // TriArt Play
});

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
  /** BIN-814: broad — where a title is obtainable at all, incl. rent and buy. */
  providers: number[];
  /**
   * BIN-845: the flatrate/free/ads subset. `null` means the doc predates the
   * BIN-814 split and has no subscription answer yet — readers fall back to
   * `providers`. `[]` is a real answer ("no subscription covers this") and must
   * not be conflated with it.
   */
  subscriptionProviders: number[] | null;
  genreIds: number[];
}

/**
 * Top tracked titles. BIN-560 Phase 4: keyed by the composite `${mediaType}_${tmdbId}`,
 * NOT bare tmdbId — a movie and a TV show sharing a TMDB number are distinct titles
 * and must not fold into one row with a bogus summed count + first-seen label.
 */
/**
 * BIN-845 — the provider ids a rolled-up tally may count.
 *
 * The subscription subset, not the broad `providers` array: since BIN-814 the broad
 * one also carries rent and buy, and counting those inflates every service that
 * happens to run a rent store. `null` means the doc predates the split and has no
 * subscription answer — fall back to the broad array rather than dropping the row,
 * which is the same rule the client's own stats page uses. `[]` is a real answer and
 * must NOT fall back.
 *
 * Extracted so the distinction is testable without the Admin SDK.
 */
export function tallyProviderIds(item: Pick<WatchlistLite, 'providers' | 'subscriptionProviders'>): number[] {
  return item.subscriptionProviders ?? item.providers;
}

export function topTitles(
  items: WatchlistLite[],
  limit: number,
): RollupData['topTitles'] {
  const byId = new Map<string, { tmdbId: number; mediaType: MediaType; title: string; count: number }>();
  for (const it of items) {
    const mediaType: MediaType = it.mediaType === 'tv' ? 'tv' : 'movie';
    const key = mediaTypeDocId(mediaType, it.tmdbId);
    const existing = byId.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byId.set(key, {
        tmdbId: it.tmdbId,
        mediaType,
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
