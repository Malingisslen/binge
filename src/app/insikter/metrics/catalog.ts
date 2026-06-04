import type { MetricKey, MetricDef } from './types';

/**
 * The single source of truth for what the dashboard shows and how. Adding a
 * metric = a catalog entry here + a resolver in resolvers.ts (+ a field in
 * InsightsData and a line in the rollup/API if it needs new data). The
 * components never hard-code a metric.
 */
export const METRICS: Record<MetricKey, MetricDef> = {
  // ── Översikt ──────────────────────────────────────────────────────────────
  totalUsers: { key: 'totalUsers', label: 'Användare', category: 'overview', format: { kind: 'number' } },
  newUsers: { key: 'newUsers', label: 'Nya användare', category: 'overview', format: { kind: 'number' } },
  activeVisitors: { key: 'activeVisitors', label: 'Aktiva besökare', category: 'overview', format: { kind: 'number' } },
  totalTitlesTracked: { key: 'totalTitlesTracked', label: 'Titlar spårade', category: 'overview', format: { kind: 'number' } },
  totalReviews: { key: 'totalReviews', label: 'Recensioner', category: 'overview', format: { kind: 'number' } },
  titlesAdded: { key: 'titlesAdded', label: 'Titlar tillagda', category: 'overview', format: { kind: 'number' } },

  // ── Tillväxt ──────────────────────────────────────────────────────────────
  signupsTrend: { key: 'signupsTrend', label: 'Registreringar', category: 'growth', format: { kind: 'number' } },
  onboardingFunnel: { key: 'onboardingFunnel', label: 'Onboarding-tratt', category: 'growth', format: { kind: 'number' } },
  signinMethodSplit: { key: 'signinMethodSplit', label: 'Inloggningsmetod', category: 'growth', format: { kind: 'number' } },
  donateClicks: { key: 'donateClicks', label: 'Donate-klick', category: 'growth', format: { kind: 'number' } },

  // ── Produktanvändning ───────────────────────────────────────────────────────
  statusDistribution: { key: 'statusDistribution', label: 'Status-fördelning', category: 'product', format: { kind: 'number' } },
  mediaTypeSplit: { key: 'mediaTypeSplit', label: 'Film vs TV', category: 'product', format: { kind: 'number' } },
  topTitles: { key: 'topTitles', label: 'Mest spårade titlar', category: 'product', format: { kind: 'number' } },
  topProviders: { key: 'topProviders', label: 'Toppade streamingtjänster', category: 'product', format: { kind: 'number' } },
  topGenres: { key: 'topGenres', label: 'Toppade genrer', category: 'product', format: { kind: 'number' } },
  ratingsHistogram: { key: 'ratingsHistogram', label: 'Betygsfördelning', category: 'product', format: { kind: 'number' } },
  advisorPauses: { key: 'advisorPauses', label: 'Rådgivar-pauser', category: 'product', format: { kind: 'number' } },
  activeSessions: { key: 'activeSessions', label: 'Aktiva sessioner', category: 'product', format: { kind: 'number' } },
  groupsCount: { key: 'groupsCount', label: 'Grupper', category: 'product', format: { kind: 'number' } },

  // ── Trafik ──────────────────────────────────────────────────────────────────
  pageViews: { key: 'pageViews', label: 'Sidvisningar', category: 'traffic', format: { kind: 'number' } },
  visitors: { key: 'visitors', label: 'Besökare', category: 'traffic', format: { kind: 'number' } },
  avgSessionDuration: { key: 'avgSessionDuration', label: 'Snitt sessionstid', category: 'traffic', format: { kind: 'duration', unit: 's' } },
  topPages: { key: 'topPages', label: 'Toppsidor', category: 'traffic', format: { kind: 'number' } },
  topReferrers: { key: 'topReferrers', label: 'Topp-hänvisare', category: 'traffic', format: { kind: 'number' } },
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
