/**
 * Declarative metric catalog types. Each dashboard metric is one MetricDef in
 * catalog.ts; a resolver in resolvers.ts maps InsightsData → MetricValue. The
 * generic components (MetricTile, Donut, Funnel…) are catalog-driven and never
 * hard-code a specific metric.
 */

export type MetricKey =
  // Översikt
  | 'totalUsers' | 'newUsers' | 'totalTitlesTracked' | 'totalReviews' | 'titlesAdded'
  | 'activeUsers7d' | 'activeUsers30d'
  // Tillväxt
  | 'signupsTrend' | 'onboardingFunnel' | 'signinMethodSplit' | 'donateClicks'
  | 'signupLandingPages' | 'providerClicks' | 'providerClicksByType'
  | 'shareClicks' | 'shareClicksBySurface' | 'priceCheckTotals' | 'priceCheckSaves'
  // Produktanvändning
  | 'statusDistribution' | 'mediaTypeSplit' | 'topTitles' | 'topProviders' | 'topGenres'
  | 'ratingsHistogram' | 'advisorPauses' | 'activeSessions' | 'groupsCount'
  // Fråga Binge (NL-sök, BIN-176)
  | 'askSearches' | 'askZeroRate' | 'askLowConfidence'
  | 'askResultBuckets' | 'askStrandingFilters' | 'askRemovedChips'
  // Trafik
  | 'pageViews' | 'avgSessionDuration' | 'topPages' | 'topReferrers';

export type MetricCategory = 'overview' | 'growth' | 'product' | 'traffic';

export type MetricFormat =
  | { kind: 'number'; decimals?: number }
  | { kind: 'percent' }
  | { kind: 'duration'; unit: 'ms' | 's' };

export interface Threshold {
  good: { max: number; label: string };
  ok: { max: number; label: string };
  bad: { max: number; label: string };
  worse?: { label: string };
  direction: 'lower-is-better' | 'higher-is-better';
}

export interface MetricDef {
  key: MetricKey;
  label: string;
  category: MetricCategory;
  format: MetricFormat;
  thresholds?: Threshold;
  isNew?: boolean;
  /** 'events' = räknas ur eventStats; rutan visar enheten "händelser", inte personer. */
  source?: 'events';
}

export interface Explanation {
  whatIsIt: string;
  howCalculated: string;
  whyImportant: string;
  source: string;
}

// `missing` säger VARFÖR ett värde saknas (se MISSING i resolvers.ts), så att "inte mätt"
// aldrig läses som noll eller som en tom lista.
export type MetricValue = (
  | { kind: 'scalar'; value: number; previous?: number }
  | { kind: 'series'; points: { x: string; y: number }[] }
  | { kind: 'breakdown'; entries: { label: string; value: number }[] }
  | { kind: 'funnel'; steps: { name: string; count: number; pctOfStart: number }[] }
) & { missing?: string };
