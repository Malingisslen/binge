/**
 * Canonical shape of the /api/insights response `data` object (Fas 1).
 *
 * This is the contract between the Cloud Function and the frontend. It is
 * mirrored verbatim in src/app/insikter/insights.types.ts — the two TS
 * projects (functions/ commonjs vs the Next app) are not wired to share a
 * module, so the type is duplicated. Keep them in sync.
 */

export type WatchStatus = 'vill_se' | 'mina' | 'sedd' | 'avbruten';
export type MediaType = 'movie' | 'tv';

export interface RangeInfo {
  from: string;
  to: string;
  preset: '24h' | '7d' | '30d' | '90d' | 'custom';
}

/** Current-state aggregates derived from Firestore by the scheduled rollup. */
export interface RollupData {
  computedAt: string; // ISO timestamp of the rollup run
  totals: {
    users: number;
    titlesTracked: number; // total watchlist docs across all users
    reviews: number;
    activeSessions: number; // Tillsammans-sessioner not yet expired
    groups: number;
  };
  statusDistribution: { vill_se: number; mina: number; sedd: number; avbruten: number };
  mediaTypeSplit: { movie: number; tv: number };
  ratingsHistogram: number[]; // length 10, index i => rating (i+1)
  topTitles: { tmdbId: number; mediaType: MediaType; title: string; count: number }[];
  topProviders: { providerId: number; count: number }[];
  topGenres: { genreId: number; count: number }[];
  readsUsed: number; // self-reported Firestore document reads this run (cost visibility)
  partial: boolean; // true if one or more sub-queries failed
}

/** Live behavioural + traffic data pulled from the Plausible Stats API. */
export interface PlausibleData {
  visitors: number;
  pageviews: number;
  avgVisitDurationSec: number;
  bounceRatePct: number;
  visitorsTimeseries: { date: string; visitors: number }[];
  topPages: { page: string; visitors: number }[];
  topReferrers: { referrer: string; visitors: number }[];
  goals: {
    signed_up: number;
    title_added_watchlist: number;
    review_created: number;
    advisor_pause_taken: number;
    donate_clicked: number;
  };
  signupsTimeseries: { date: string; count: number }[];
  onboardingFunnel: { step: number; count: number }[];
  signinMethodSplit: { google: number; email: number };
}

/** Fråga Binge usage/error counters aggregated over the requested range. */
export interface AskBingeData {
  searches: number;       // completed searches (parsed + ran a query)
  zeroResults: number;    // of those, how many returned nothing
  lowConfidence: number;  // submits the parser couldn't extract anything from
  chipRemovals: number;   // interpreted-chip deletions ("you guessed wrong")
  resultBuckets: { '0': number; '1-9': number; '10-29': number; '30+': number };
  topStrandingFilters: { filters: string; searches: number; zero: number }[]; // by zero desc
  topRemovedChips: { key: string; count: number }[]; // AskFilter key → delete count, desc
  days: number;           // number of daily docs covered (coverage hint)
}

/** Net change between today's snapshot and a baseline snapshot (period metrics). */
export interface WindowDeltas {
  basisDate: string;   // document id of the baseline snapshot (YYYY-MM-DD)
  truncated: boolean;  // baseline newer than requested window start (history too shallow)
  deltas: {
    users: number;         // raw net change (may be negative)
    titlesTracked: number; // raw net change (may be negative)
  };
}

export interface InsightsData {
  generatedAt: string; // ISO timestamp of this API response
  range: RangeInfo;
  rollup: RollupData | null; // null if the rollup doc does not exist yet
  plausible: PlausibleData | null; // null if Plausible is unconfigured/unreachable
  askBinge: AskBingeData | null; // null if the read failed; zeroed if simply no data yet
  window: WindowDeltas | null; // null until at least one prior snapshot exists
  partial: boolean; // true if any source failed (frontend shows a ribbon)
}
