/**
 * Mirror of functions/src/insights/types.ts — the /api/insights response shape.
 *
 * Duplicated rather than imported: the Cloud Function (functions/, commonjs) and
 * this Next app are separate TS projects with no shared module wiring. Keep this
 * in sync with the functions copy.
 */

export type WatchStatus = 'vill_se' | 'mina' | 'sedd' | 'avbruten';
export type MediaType = 'movie' | 'tv';

export interface RangeInfo {
  from: string;
  to: string;
  preset: '24h' | '7d' | '30d' | '90d' | 'custom';
}

export interface RollupData {
  computedAt: string;
  totals: {
    users: number;
    titlesTracked: number;
    reviews: number;
    activeSessions: number;
    groups: number;
  };
  statusDistribution: { vill_se: number; mina: number; sedd: number; avbruten: number };
  mediaTypeSplit: { movie: number; tv: number };
  ratingsHistogram: number[];
  topTitles: { tmdbId: number; mediaType: MediaType; title: string; count: number }[];
  topProviders: { providerId: number; count: number }[];
  topGenres: { genreId: number; count: number }[];
  readsUsed: number;
  partial: boolean;
}

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
  searches: number;
  zeroResults: number;
  lowConfidence: number;
  chipRemovals: number;
  resultBuckets: { '0': number; '1-9': number; '10-29': number; '30+': number };
  topStrandingFilters: { filters: string; searches: number; zero: number }[];
  topRemovedChips: { key: string; count: number }[];
  days: number;
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
  generatedAt: string;
  range: RangeInfo;
  rollup: RollupData | null;
  plausible: PlausibleData | null;
  askBinge: AskBingeData | null; // null if the read failed; zeroed if no data yet
  window: WindowDeltas | null; // null until at least one prior snapshot exists
  partial: boolean;
}
