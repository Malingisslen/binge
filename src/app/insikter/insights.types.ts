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
  // Non-anonymous Auth accounts seen within 7 / 30 days (decision 8). Optional:
  // rollup docs written before this field existed lack it.
  activeUsers?: { d7: number; d30: number };
  // BIN-1442: accounts whose second week closed within the last 30 days (cohort)
  // and how many of them opened Binge in it (returned). Optional: older docs lack it.
  secondWeekReturn?: { returned: number; cohort: number };
  statusDistribution: { vill_se: number; mina: number; sedd: number; avbruten: number };
  mediaTypeSplit: { movie: number; tv: number };
  ratingsHistogram: number[];
  topTitles: { tmdbId: number; mediaType: MediaType; title: string; count: number }[];
  topProviders: { providerId: number; count: number }[];
  topGenres: { genreId: number; count: number }[];
  readsUsed: number;
  partial: boolean;
}

export interface EventsData {
  counts: Record<string, number>;
  props: Record<string, Record<string, Record<string, number>>>;
  daily: { date: string; counts: Record<string, number> }[];
  days: number;
}

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

/** One day's aggregate totals from a dated insights/{YYYY-MM-DD} doc. */
export interface HistoryPoint {
  date: string;
  users: number;
  titlesTracked: number;
  reviews: number;
  activeUsers7d?: number;  // absent on docs written before activeUsers existed
  activeUsers30d?: number;
}

/**
 * Besök ur Cloudflare Web Analytics över intervallet. Bara aggregat: inga besökare,
 * inga IP-adresser, bara summor per dag, sida och hänvisande värd.
 */
export interface TrafficData {
  visits: number;
  pageViews: number;
  daily: { date: string; visits: number; pageViews: number }[];
  topPages: { path: string; pageViews: number }[];
  topReferrers: { host: string; visits: number }[]; // host '' = direkt / okänd hänvisare
}

export interface InsightsData {
  generatedAt: string;
  range: RangeInfo;
  rollup: RollupData | null;
  events: EventsData | null; // null = not measured in the range (no eventStats docs) or read failed
  eventsSince: string | null;
  askBinge: AskBingeData | null; // null if the read failed; zeroed if no data yet
  window: WindowDeltas | null; // null until at least one prior snapshot exists
  history?: HistoryPoint[] | null; // dated snapshots in the range, oldest first; null = read failed. Optional until the function is deployed.
  traffic?: TrafficData | null; // Cloudflare Web Analytics; null = not fetched. Optional until the function is deployed.
  partial: boolean;
}
