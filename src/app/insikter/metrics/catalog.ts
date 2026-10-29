import type { MetricKey, MetricDef } from './types';

/**
 * The single source of truth for what the dashboard shows and how. Adding a
 * metric = a catalog entry here + a resolver in resolvers.ts + an explanation in
 * explanations.ts (+ a field in InsightsData and a line in the rollup/API if it
 * needs new data). The components never hard-code a metric.
 *
 * `snapshot` metrics come from the latest once-a-day rollup and ignore the date
 * picker; `comparable` metrics are period sums that get a "mot förra perioden"
 * comparison (comparison.ts). A metric is never both — catalog.test.ts enforces it.
 */
export const METRICS: Record<MetricKey, MetricDef> = {
  // ── Just nu ───────────────────────────────────────────────────────────────
  totalUsers: { key: 'totalUsers', label: 'Användare', category: 'now', format: { kind: 'number' }, snapshot: true },
  totalTitlesTracked: { key: 'totalTitlesTracked', label: 'Titlar i bibliotek', category: 'now', format: { kind: 'number' }, snapshot: true },
  totalReviews: { key: 'totalReviews', label: 'Recensioner', category: 'now', format: { kind: 'number' }, snapshot: true },
  activeUsers7d: { key: 'activeUsers7d', label: 'Aktiva senaste 7 dagarna', category: 'now', format: { kind: 'number' }, snapshot: true },
  activeUsers30d: { key: 'activeUsers30d', label: 'Aktiva senaste 30 dagarna', category: 'now', format: { kind: 'number' }, snapshot: true },
  activeSessions: { key: 'activeSessions', label: 'Pågående Tillsammans-kvällar', category: 'now', format: { kind: 'number' }, snapshot: true },
  groupsCount: { key: 'groupsCount', label: 'Skapade grupper', category: 'now', format: { kind: 'number' }, snapshot: true },

  // ── I perioden ────────────────────────────────────────────────────────────
  newUsers: { key: 'newUsers', label: 'Nya användare', category: 'period', format: { kind: 'number' }, comparable: true, windowField: 'users' },
  titlesAdded: { key: 'titlesAdded', label: 'Fler titlar i bibliotek', category: 'period', format: { kind: 'number' }, comparable: true, windowField: 'titlesTracked' },
  signupsTrend: { key: 'signupsTrend', label: 'Registreringar per dag', category: 'period', format: { kind: 'number' }, source: 'events' },
  signins: { key: 'signins', label: 'Inloggningar', category: 'period', format: { kind: 'number' }, source: 'events', comparable: true },
  signinMethodSplit: { key: 'signinMethodSplit', label: 'Inloggningssätt', category: 'period', format: { kind: 'number' }, source: 'events' },
  onboardingFinishStep: { key: 'onboardingFinishStep', label: 'Vilket steg nya användare avslutade på', category: 'period', format: { kind: 'number' }, source: 'events' },
  secondWeekReturn: { key: 'secondWeekReturn', label: 'Nya konton som kom tillbaka andra veckan', category: 'period', format: { kind: 'number' }, snapshot: true },

  // ── Engagemang ────────────────────────────────────────────────────────────
  titlesAddedTrend: { key: 'titlesAddedTrend', label: 'Titlar tillagda per dag', category: 'engagement', format: { kind: 'number' }, source: 'events' },
  providerClicks: { key: 'providerClicks', label: 'Klick till tjänster', category: 'engagement', format: { kind: 'number' }, source: 'events', comparable: true },
  providerClicksByType: { key: 'providerClicksByType', label: 'Klick till tjänster per typ', category: 'engagement', format: { kind: 'number' }, source: 'events' },
  shareClicks: { key: 'shareClicks', label: 'Delningar', category: 'engagement', format: { kind: 'number' }, source: 'events', comparable: true },
  shareClicksBySurface: { key: 'shareClicksBySurface', label: 'Delningar per yta', category: 'engagement', format: { kind: 'number' }, source: 'events' },
  shareClicksByMethod: { key: 'shareClicksByMethod', label: 'Delningssätt', category: 'engagement', format: { kind: 'number' }, source: 'events' },
  priceCheckTotals: { key: 'priceCheckTotals', label: 'Priskollar som gav en summa', category: 'engagement', format: { kind: 'number' }, source: 'events', comparable: true },
  priceCheckBySurface: { key: 'priceCheckBySurface', label: 'Var priskollen används', category: 'engagement', format: { kind: 'number' }, source: 'events' },
  priceCheckSaves: { key: 'priceCheckSaves', label: 'Priskoll: logga in och spara', category: 'engagement', format: { kind: 'number' }, source: 'events', comparable: true },
  advisorActions: { key: 'advisorActions', label: 'Rådgivarens förslag folk tog', category: 'engagement', format: { kind: 'number' }, source: 'events' },

  // ── Biblioteket ───────────────────────────────────────────────────────────
  statusDistribution: { key: 'statusDistribution', label: 'Vad folk gör med titlarna', category: 'library', format: { kind: 'number' }, snapshot: true },
  mediaTypeSplit: { key: 'mediaTypeSplit', label: 'Film eller serie', category: 'library', format: { kind: 'number' }, snapshot: true },
  topTitles: { key: 'topTitles', label: 'Titlar flest har i biblioteket', category: 'library', format: { kind: 'number' }, snapshot: true },
  topProviders: { key: 'topProviders', label: 'Vanligaste streamingtjänsterna', category: 'library', format: { kind: 'number' }, snapshot: true },
  topGenres: { key: 'topGenres', label: 'Vanligaste genrerna', category: 'library', format: { kind: 'number' }, snapshot: true },
  ratingsHistogram: { key: 'ratingsHistogram', label: 'Betygsfördelning', category: 'library', format: { kind: 'number' }, snapshot: true },

  // ── Fråga Binge (NL-sök, BIN-176) ───────────────────────────────────────────
  askSearches: { key: 'askSearches', label: 'Sökningar', category: 'ask', format: { kind: 'number' } },
  askZeroRate: { key: 'askZeroRate', label: 'Sökningar utan träff', category: 'ask', format: { kind: 'percent' } },
  askLowConfidenceRate: { key: 'askLowConfidenceRate', label: 'Frågor Binge inte förstod', category: 'ask', format: { kind: 'percent' } },
  askResultBuckets: { key: 'askResultBuckets', label: 'Antal träffar per sökning', category: 'ask', format: { kind: 'number' } },
  askStrandingFilters: { key: 'askStrandingFilters', label: 'Filterkombinationer som ger noll träffar', category: 'ask', format: { kind: 'number' } },
  askRemovedChips: { key: 'askRemovedChips', label: 'Filter folk oftast tar bort', category: 'ask', format: { kind: 'number' } },

  // ── Besök (Cloudflare Web Analytics) ──────────────────────────────────────
  visits: { key: 'visits', label: 'Besök', category: 'traffic', format: { kind: 'number' }, source: 'traffic', comparable: true },
  pageViews: { key: 'pageViews', label: 'Sidvisningar', category: 'traffic', format: { kind: 'number' }, source: 'traffic', comparable: true },
  visitsTrend: { key: 'visitsTrend', label: 'Besök per dag', category: 'traffic', format: { kind: 'number' }, source: 'traffic' },
  topPages: { key: 'topPages', label: 'Topp 10 sidor', category: 'traffic', format: { kind: 'number' }, source: 'traffic' },
  topReferrers: { key: 'topReferrers', label: 'Topp 10 varifrån folk kommer', category: 'traffic', format: { kind: 'number' }, source: 'traffic' },
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
