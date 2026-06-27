// BIN-178 — pure logic for the "vad försvinner" rollup. No firebase-admin import
// → runs under the root Vitest suite.
//
// Collapses the per-title streamingOffers docs into ONE small doc keyed by
// provider: streamingLeaving/current.byProvider[providerId] = titles whose
// SUBSCRIPTION offer leaves that service within the window. The /forsvinner/
// [provider] page reads this single doc client-side (one read) and enriches
// titles via TMDB. Only subscription offers count — a rent/buy window expiring
// is not "leaving the service". Provider ids are canonicalised so an aliased id
// folds into its primary. Dates compared lexicographically (YYYY-MM-DD).

import { canonicalProviderId } from '../availableNotify/logic';

export interface RollupOffer {
  providerId: number;
  type: string;
  leaving: string | null;
}

export interface RollupDoc {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  offers: RollupOffer[];
}

export interface LeavingEntry {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  leaving: string; // YYYY-MM-DD
}

export interface LeavingRollup {
  byProvider: Record<string, LeavingEntry[]>;
}

/** YYYY-MM-DD shifted by `days` (UTC), returned as YYYY-MM-DD. */
export function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Build the per-provider leaving rollup. A title appears under a provider when it
 * has a subscription offer on that (canonical) provider leaving within
 * [today, today+withinDays]. Soonest leaving wins per (provider, title); each
 * provider's list is sorted nearest-deadline-first and capped.
 */
export function buildLeavingRollup(
  docs: readonly RollupDoc[],
  today: string,
  withinDays = 45,
  capPerProvider = 80,
): LeavingRollup {
  const upper = addDaysIso(today, withinDays);
  // providerId -> (tmdbId -> soonest entry)
  const byProviderMap = new Map<number, Map<number, LeavingEntry>>();

  for (const doc of docs) {
    for (const o of doc.offers) {
      if (o.type !== 'subscription' || !o.leaving) continue;
      if (o.leaving < today || o.leaving > upper) continue;
      const pid = canonicalProviderId(o.providerId);
      let perTitle = byProviderMap.get(pid);
      if (!perTitle) byProviderMap.set(pid, (perTitle = new Map()));
      const existing = perTitle.get(doc.tmdbId);
      if (!existing || o.leaving < existing.leaving) {
        perTitle.set(doc.tmdbId, { tmdbId: doc.tmdbId, mediaType: doc.mediaType, leaving: o.leaving });
      }
    }
  }

  const byProvider: Record<string, LeavingEntry[]> = {};
  for (const [pid, perTitle] of byProviderMap) {
    byProvider[String(pid)] = [...perTitle.values()]
      .sort((a, b) => a.leaving.localeCompare(b.leaving) || a.tmdbId - b.tmdbId)
      .slice(0, capPerProvider);
  }
  return { byProvider };
}
