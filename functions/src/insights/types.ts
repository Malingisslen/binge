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

export interface InsightsData {
  generatedAt: string; // ISO timestamp of this API response
  range: RangeInfo;
  rollup: RollupData | null; // null if the rollup doc does not exist yet
  plausible: PlausibleData | null; // null if Plausible is unconfigured/unreachable
  partial: boolean; // true if any source failed (frontend shows a ribbon)
}
