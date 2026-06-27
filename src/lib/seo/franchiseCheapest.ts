// BIN-178 — "Billigaste sättet att se hela [franchise]". Pure logic over data
// available at BUILD time: each film's SE flatrate/free provider ids (from TMDB
// watch/providers) + whether a rent/buy offer exists. TMDB does NOT expose rent
// PRICES (those are MOTN/runtime), so the verdict reasons about which single
// subscription covers the most of the franchise and points at title pages for
// exact rent prices — never fabricates an amount.
//
// Model: pick the ONE subscription that covers the most films (tie → a free
// public service, then the cheapest monthly cost, then lowest id). Honest and
// simple — not a multi-service set-cover, which would over-promise precision the
// build-time data can't back.

import { canonicalProviderId, getProvider } from '@/lib/tmdb/providers';

export interface FranchiseFilm {
  tmdbId: number;
  title: string;
  year: string | null;
  /** SE flatrate/free provider ids the film streams on (raw; canonicalised here). */
  subscriptionProviderIds: number[];
  /** A SE rent or buy offer exists (TMDB lists it; no price at build time). */
  rentable: boolean;
}

export interface RemainderFilm {
  tmdbId: number;
  title: string;
  year: string | null;
  rentable: boolean;
}

export interface FranchisePlan {
  totalFilms: number;
  bestProviderId: number | null;
  bestProviderName: string | null;
  bestProviderMonthlyCost: number | null;
  /** Films the chosen subscription covers. */
  coveredCount: number;
  /** Films not on the chosen subscription. */
  remainder: RemainderFilm[];
  /** Remainder films that can be rented/bought. */
  rentCount: number;
  /** Films with no SE subscription and no rent/buy at all. */
  unavailableCount: number;
}

/**
 * Choose the single subscription covering the most franchise films.
 * Tie-break: free public service (0 kr) → lowest monthly cost → lowest id.
 */
function pickBestProvider(films: readonly FranchiseFilm[]): number | null {
  const coverage = new Map<number, number>();
  for (const f of films) {
    for (const id of new Set(f.subscriptionProviderIds.map(canonicalProviderId))) {
      coverage.set(id, (coverage.get(id) ?? 0) + 1);
    }
  }
  if (coverage.size === 0) return null;

  const cost = (id: number) => getProvider(id)?.defaultMonthlyCost ?? Number.POSITIVE_INFINITY;
  const isFree = (id: number) => getProvider(id)?.isFree === true;

  return [...coverage.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];               // most coverage wins
    if (isFree(a[0]) !== isFree(b[0])) return isFree(a[0]) ? -1 : 1; // free first
    if (cost(a[0]) !== cost(b[0])) return cost(a[0]) - cost(b[0]);   // cheapest monthly
    return a[0] - b[0];                                   // stable: lowest id
  })[0][0];
}

export function franchisePlan(films: readonly FranchiseFilm[]): FranchisePlan {
  const bestProviderId = pickBestProvider(films);
  const provider = bestProviderId != null ? getProvider(bestProviderId) : null;

  let coveredCount = 0;
  const remainder: RemainderFilm[] = [];
  for (const f of films) {
    const subs = new Set(f.subscriptionProviderIds.map(canonicalProviderId));
    if (bestProviderId != null && subs.has(bestProviderId)) {
      coveredCount += 1;
    } else {
      remainder.push({ tmdbId: f.tmdbId, title: f.title, year: f.year, rentable: f.rentable });
    }
  }

  const rentCount = remainder.filter((r) => r.rentable).length;
  // Unavailable: not covered by the chosen sub AND not rentable. (A film on a
  // *different* subscription than the chosen one still counts here as "not on the
  // plan" but rentable=false → unavailable via this single-subscription plan;
  // that's the honest framing of a one-service plan.)
  const unavailableCount = remainder.length - rentCount;

  return {
    totalFilms: films.length,
    bestProviderId,
    bestProviderName: provider?.name ?? null,
    bestProviderMonthlyCost: provider?.defaultMonthlyCost ?? null,
    coveredCount,
    remainder,
    rentCount,
    unavailableCount,
  };
}
