// BIN-169 — "Billigaste sättet att se hela listan": a cheapest-way optimizer
// over a user's list / group watchlist. The runtime cousin of franchiseCheapest
// (BIN-178, build-time franchise) — but here we HAVE the user's own provider
// costs and owned set, so we reason in INCREMENTAL kr and can produce both the
// best single subscription for the list and the cheapest full-coverage bundle.
//
// Honesty rule (identical to franchiseCheapest + cheapestPath): TMDB exposes
// rent/buy AVAILABILITY, not price. So the rent/buy remainder is only ever
// COUNTED (rentCount / unavailableCount) — never summed into a fabricated kr
// total. Every kr this module emits is a subscription monthly cost we actually
// know (the user's chosen tier / custom cost / catalog default, via
// resolveProviderMonthlyCost), and 0 for a service the user already owns.
//
// Free gating (role #28 must-have): a 0-kr *ads* service (Pluto TV,
// defaultMonthlyCost 0 but isAds) is NOT "free". The free tie-break rung gates
// on isFree === true, never on cost === 0 — same as franchisePlan.

import { canonicalProviderId, getProvider, resolveProviderMonthlyCost } from '@/lib/tmdb/providers';

export interface ListTitle {
  tmdbId: number;
  title: string;
  /** SE flatrate/free subscription provider ids the title streams on (raw; canonicalised here). */
  subscriptionProviderIds: number[];
  /** A SE rent or buy offer exists (TMDB lists it; no price available). */
  rentable: boolean;
}

export interface UnplannedTitle {
  tmdbId: number;
  title: string;
  rentable: boolean;
}

export interface UserCostSettings {
  providerTiers?: Record<number, string>;
  providerCosts?: Record<number, number>;
  /** Services the user already pays for → 0 kr incremental for this list. */
  ownedProviderIds?: number[];
}

/** Which single subscription unlocks the most of this list (partial coverage OK). */
export interface BestSingle {
  providerId: number | null;
  providerName: string | null;
  /** INCREMENTAL monthly cost (0 if already owned); null when nothing streams. */
  monthlyKr: number | null;
  coveredCount: number;
  /** Titles not on the chosen service (may be on other subs, rent-only, or nowhere). */
  remainder: UnplannedTitle[];
  /** Remainder titles that can be rented/bought (counted, never priced). */
  rentCount: number;
  /** Remainder titles with no path via this single plan (identical semantics to franchisePlan). */
  unavailableCount: number;
}

/** The cheapest SET of subscriptions covering every streamable title in the list. */
export interface FullPlan {
  /** Canonical service ids in the cheapest cover, ascending. */
  serviceIds: number[];
  /** Sum of incremental monthly costs of those services. */
  monthlyKr: number;
  streamableCovered: number;
  /** Non-streamable titles that are rentable (counted, never priced). */
  rentCount: number;
  /** Non-streamable titles with no path at all in SE. */
  unavailableCount: number;
}

export interface ListPlan {
  totalTitles: number;
  /** Titles available on at least one subscription service. */
  streamableCount: number;
  bestSingle: BestSingle;
  fullPlan: FullPlan;
  /** Incremental cost of subscribing to EVERY distinct service carrying a streamable title. */
  naiveMonthlyKr: number;
  /** naiveMonthlyKr − fullPlan.monthlyKr, floored at 0 — saving from consolidating. */
  savingKr: number;
}

// Above this many DISTINCT services (or streamable titles) we fall back from
// exact min-cost cover to a greedy heuristic. The Swedish flatrate market is ~15
// services and curated lists are tens of titles, so a real list never reaches
// these; the caps only guard a pathological input from blowing up the 2^S subset
// enumeration (services) or overflowing a 32-bit title bitmask (titles).
const MAX_EXACT_SERVICES = 18;
const MAX_EXACT_TITLES = 30;

function isFree(id: number): boolean {
  return getProvider(id)?.isFree === true;
}

function makeCost(user: UserCostSettings) {
  const owned = new Set((user.ownedProviderIds ?? []).map(canonicalProviderId));
  return (id: number): number => {
    if (owned.has(id)) return 0; // already paid for → 0 incremental
    return resolveProviderMonthlyCost(id, user) ?? 0;
  };
}

/**
 * Distinct canonical subscription ids for a title (order-preserving, deduped),
 * restricted to ids we can both name and price. An uncatalogued id (a TMDB SE
 * provider not yet in SWEDISH_PROVIDERS — these surface before they're added) is
 * dropped: we won't credit a title to a phantom, unpriceable service, which
 * would otherwise resolve to 0 kr and be mistaken for a free win. Such a title
 * falls to its rent/unavailable bucket instead — honest over optimistic.
 */
function subsOf(t: ListTitle): number[] {
  return [
    ...new Set(
      t.subscriptionProviderIds
        .map(canonicalProviderId)
        .filter((id) => getProvider(id) !== undefined),
    ),
  ];
}

function emptyBestSingle(): BestSingle {
  return {
    providerId: null,
    providerName: null,
    monthlyKr: null,
    coveredCount: 0,
    remainder: [],
    rentCount: 0,
    unavailableCount: 0,
  };
}

function pickBestSingle(titles: readonly ListTitle[], cost: (id: number) => number): BestSingle {
  const coverage = new Map<number, number>();
  for (const t of titles) {
    for (const id of subsOf(t)) coverage.set(id, (coverage.get(id) ?? 0) + 1);
  }
  if (coverage.size === 0) return emptyBestSingle();

  // Tie-break order mirrors franchisePlan exactly: coverage desc → free first
  // (isFree only, never cost===0) → cheapest incremental cost → lowest id.
  const bestId = [...coverage.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (isFree(a[0]) !== isFree(b[0])) return isFree(a[0]) ? -1 : 1;
    if (cost(a[0]) !== cost(b[0])) return cost(a[0]) - cost(b[0]);
    return a[0] - b[0];
  })[0][0];

  const remainder: UnplannedTitle[] = [];
  let coveredCount = 0;
  for (const t of titles) {
    if (subsOf(t).includes(bestId)) coveredCount += 1;
    else remainder.push({ tmdbId: t.tmdbId, title: t.title, rentable: t.rentable });
  }
  const rentCount = remainder.filter((r) => r.rentable).length;
  return {
    providerId: bestId,
    providerName: getProvider(bestId)?.name ?? null,
    monthlyKr: cost(bestId),
    coveredCount,
    remainder,
    rentCount,
    unavailableCount: remainder.length - rentCount,
  };
}

interface Cover {
  ids: number[]; // ascending
  cost: number;
}

/** A cover A is better than B: lower cost → fewer services → lexicographically smaller ids. */
function better(a: Cover, b: Cover): boolean {
  if (a.cost !== b.cost) return a.cost < b.cost;
  if (a.ids.length !== b.ids.length) return a.ids.length < b.ids.length;
  for (let i = 0; i < a.ids.length; i++) {
    if (a.ids[i] !== b.ids[i]) return a.ids[i] < b.ids[i];
  }
  return false;
}

/**
 * Cheapest set of services whose union covers every streamable title. Exact via
 * subset enumeration when distinct services ≤ MAX_EXACT_SERVICES (min-cost set
 * cover is not solvable by naive greedy — Netflix-alone can beat Prime+Netflix
 * even though Prime has the better per-title ratio), else a greedy fallback.
 */
function cheapestCover(
  streamable: readonly ListTitle[],
  cost: (id: number) => number,
): Cover {
  if (streamable.length === 0) return { ids: [], cost: 0 };

  const services = [...new Set(streamable.flatMap(subsOf))].sort((a, b) => a - b);
  // Which streamable-title indices each service covers.
  const coverOf = new Map<number, Set<number>>();
  for (const id of services) coverOf.set(id, new Set());
  streamable.forEach((t, i) => {
    for (const id of subsOf(t)) coverOf.get(id)!.add(i);
  });

  // Exact min-cost set cover via subset enumeration. 32-bit number bitmasks over
  // title indices — safe while both caps hold (services ≤18, titles ≤30). Naive
  // greedy is NOT exact here (Netflix-alone can beat Prime+Netflix despite Prime's
  // better per-title ratio), so we enumerate when the input is small enough.
  if (services.length <= MAX_EXACT_SERVICES && streamable.length <= MAX_EXACT_TITLES) {
    const maskOf = new Map<number, number>();
    for (const id of services) {
      let m = 0;
      for (const i of coverOf.get(id)!) m |= 1 << i;
      maskOf.set(id, m);
    }
    const fullMask = (1 << streamable.length) - 1;
    let best: Cover | null = null;
    const total = 1 << services.length;
    for (let subset = 1; subset < total; subset++) {
      let covered = 0;
      let c = 0;
      const ids: number[] = [];
      for (let b = 0; b < services.length; b++) {
        if (subset & (1 << b)) {
          const id = services[b];
          covered |= maskOf.get(id)!;
          c += cost(id);
          ids.push(id);
        }
      }
      if (covered !== fullMask) continue;
      const cand: Cover = { ids, cost: c }; // ids already ascending (services sorted)
      if (best === null || better(cand, best)) best = cand;
    }
    return best ?? { ids: [], cost: 0 };
  }

  // Greedy fallback (pathological input only): repeatedly take the service with
  // the best newly-covered-per-kr ratio; free/owned (0 kr) taken first.
  const uncovered = new Set<number>(streamable.map((_, i) => i));
  const ids: number[] = [];
  let c = 0;
  const remaining = new Set(services);
  while (uncovered.size > 0) {
    let pick: number | null = null;
    let pickScore = -Infinity;
    for (const id of remaining) {
      let gain = 0;
      for (const i of coverOf.get(id)!) if (uncovered.has(i)) gain += 1;
      if (gain === 0) continue;
      const ic = cost(id);
      const score = ic === 0 ? Infinity : gain / ic;
      if (score > pickScore || (score === pickScore && (pick === null || id < pick))) {
        pickScore = score;
        pick = id;
      }
    }
    if (pick === null) break; // remaining titles unreachable (shouldn't happen for streamable set)
    for (const i of coverOf.get(pick)!) uncovered.delete(i);
    ids.push(pick);
    c += cost(pick);
    remaining.delete(pick);
  }
  ids.sort((a, b) => a - b);
  return { ids, cost: c };
}

export function cheapestListPlan(
  titles: readonly ListTitle[],
  user: UserCostSettings = {},
): ListPlan {
  const cost = makeCost(user);

  const streamable = titles.filter((t) => subsOf(t).length > 0);
  const nonStreamable = titles.filter((t) => subsOf(t).length === 0);

  const bestSingle = pickBestSingle(titles, cost);

  const cover = cheapestCover(streamable, cost);
  const rentCount = nonStreamable.filter((t) => t.rentable).length;
  const fullPlan: FullPlan = {
    serviceIds: cover.ids,
    monthlyKr: cover.cost,
    streamableCovered: streamable.length,
    rentCount,
    unavailableCount: nonStreamable.length - rentCount,
  };

  // Naive: subscribe to EVERY distinct service carrying a streamable title.
  const allServices = [...new Set(streamable.flatMap(subsOf))];
  const naiveMonthlyKr = allServices.reduce((sum, id) => sum + cost(id), 0);

  return {
    totalTitles: titles.length,
    streamableCount: streamable.length,
    bestSingle,
    fullPlan,
    naiveMonthlyKr,
    savingKr: Math.max(0, naiveMonthlyKr - fullPlan.monthlyKr),
  };
}
