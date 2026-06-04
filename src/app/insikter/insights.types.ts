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

export interface InsightsData {
  generatedAt: string;
  range: RangeInfo;
  rollup: RollupData | null;
  plausible: PlausibleData | null;
  partial: boolean;
}
