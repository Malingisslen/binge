/**
 * Declarative metric catalog types. Each dashboard metric is one MetricDef in
 * catalog.ts; a resolver in resolvers.ts maps InsightsData → MetricValue. The
 * generic components (MetricTile, Donut, TopList…) are catalog-driven and never
 * hard-code a specific metric.
 */

export type MetricKey =
  // Just nu (ögonblicksbilder ur senaste rollupen)
  | 'totalUsers' | 'totalTitlesTracked' | 'totalReviews'
  | 'activeUsers7d' | 'activeUsers30d' | 'activeSessions' | 'groupsCount'
  // I perioden (nya konton)
  | 'newUsers' | 'titlesAdded' | 'signupsTrend' | 'signins' | 'signinMethodSplit'
  | 'onboardingFinishStep' | 'secondWeekReturn'
  // Engagemang (händelser)
  | 'titlesAddedTrend' | 'providerClicks' | 'providerClicksByType'
  | 'shareClicks' | 'shareClicksBySurface' | 'shareClicksByMethod'
  | 'priceCheckTotals' | 'priceCheckBySurface' | 'priceCheckSaves' | 'advisorActions'
  // Biblioteket
  | 'statusDistribution' | 'mediaTypeSplit' | 'topTitles' | 'topProviders' | 'topGenres'
  | 'ratingsHistogram'
  // Fråga Binge (NL-sök, BIN-176)
  | 'askSearches' | 'askZeroRate' | 'askLowConfidenceRate'
  | 'askResultBuckets' | 'askStrandingFilters' | 'askRemovedChips'
  // Besök (Cloudflare Web Analytics)
  | 'visits' | 'pageViews' | 'visitsTrend' | 'topPages' | 'topReferrers';

export type MetricCategory = 'now' | 'period' | 'engagement' | 'library' | 'ask' | 'traffic';

export type MetricFormat =
  | { kind: 'number'; decimals?: number }
  | { kind: 'percent' };

export interface MetricDef {
  key: MetricKey;
  label: string;
  category: MetricCategory;
  format: MetricFormat;
  /**
   * 'events' = räknas ur eventStats; rutan visar enheten "händelser", inte personer.
   * 'traffic' = Cloudflare Web Analytics; jämförelsen kräver bara förra periodens `traffic`.
   */
  source?: 'events' | 'traffic';
  /** Ögonblicksbild ur senaste rollupen: följer inte datumväljaren och jämförs aldrig med en förra period. */
  snapshot?: true;
  /** Periodsumma som får en jämförelse mot föregående lika långa fönster (se comparison.ts). */
  comparable?: true;
  /** Rollup-tillväxt: vilket fält i `window.deltas` måttet läser. Jämförelsen räknar om det (comparison.ts). */
  windowField?: 'users' | 'titlesTracked';
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
  // `note` är en kort rad under talet, t.ex. antalet bakom en andel.
  // `trend` är dagsvärden bakåt för en ögonblicksbild (ur `history`), ritad som en liten kurva.
  | { kind: 'scalar'; value: number; note?: string; trend?: { x: string; y: number }[] }
  | { kind: 'series'; points: { x: string; y: number }[] }
  | { kind: 'breakdown'; entries: { label: string; value: number }[] }
) & { missing?: string };
