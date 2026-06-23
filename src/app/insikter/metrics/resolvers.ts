import type { MetricKey, MetricValue } from './types';
import type { InsightsData } from '../insights.types';
import { getProvider } from '@/lib/tmdb/providers';
import { genreLabel } from '@/lib/tmdb/genreLabels';

// ── Helpers ──────────────────────────────────────────────────────────────────

const scalar = (value: number, previous?: number): MetricValue =>
  previous === undefined ? { kind: 'scalar', value } : { kind: 'scalar', value, previous };

const emptyBreakdown: MetricValue = { kind: 'breakdown', entries: [] };

// genreLabel — Swedish genre names — moved to @/lib/tmdb/genreLabels (shared
// with the library filter, BIN-44).
const providerLabel = (id: number): string => getProvider(id)?.name ?? `Tjänst ${id}`;

// ── DATA_RESOLVERS ─────────────────────────────────────────────────────────────

export const DATA_RESOLVERS: Record<MetricKey, (data: InsightsData) => MetricValue> = {
  // ── Översikt ──────────────────────────────────────────────────────────────
  totalUsers: (d) => scalar(d.rollup?.totals.users ?? NaN),
  totalTitlesTracked: (d) => scalar(d.rollup?.totals.titlesTracked ?? NaN),
  totalReviews: (d) => scalar(d.rollup?.totals.reviews ?? NaN),
  newUsers: (d) => scalar(Math.max(0, d.window?.deltas.users ?? NaN)),
  activeVisitors: (d) => scalar(d.plausible?.visitors ?? NaN), // pure web traffic — stays Plausible
  titlesAdded: (d) => scalar(Math.max(0, d.window?.deltas.titlesTracked ?? NaN)),

  // ── Tillväxt ──────────────────────────────────────────────────────────────
  signupsTrend: (d) => ({
    kind: 'series',
    points: (d.plausible?.signupsTimeseries ?? []).map((p) => ({ x: p.date, y: p.count })),
  }),

  onboardingFunnel: (d) => {
    const steps = [...(d.plausible?.onboardingFunnel ?? [])].sort((a, b) => a.step - b.step);
    if (steps.length === 0) return { kind: 'funnel', steps: [] };
    const first = steps[0].count;
    return {
      kind: 'funnel',
      steps: steps.map((s) => ({
        name: `Steg ${s.step}`,
        count: s.count,
        pctOfStart: first === 0 ? 0 : Math.round((s.count / first) * 1000) / 10,
      })),
    };
  },

  signinMethodSplit: (d) => {
    const m = d.plausible?.signinMethodSplit;
    if (!m) return emptyBreakdown;
    return {
      kind: 'breakdown',
      entries: [
        { label: 'Google', value: m.google },
        { label: 'E-post', value: m.email },
      ],
    };
  },

  donateClicks: (d) => scalar(d.plausible?.goals.donate_clicked ?? NaN),

  // ── Produktanvändning ───────────────────────────────────────────────────────
  statusDistribution: (d) => {
    const s = d.rollup?.statusDistribution;
    if (!s) return emptyBreakdown;
    return {
      kind: 'breakdown',
      entries: [
        { label: 'Vill se', value: s.vill_se },
        { label: 'Mina', value: s.mina },
        { label: 'Sedd', value: s.sedd },
        { label: 'Avbruten', value: s.avbruten },
      ],
    };
  },

  mediaTypeSplit: (d) => {
    const m = d.rollup?.mediaTypeSplit;
    if (!m) return emptyBreakdown;
    return {
      kind: 'breakdown',
      entries: [
        { label: 'Film', value: m.movie },
        { label: 'TV', value: m.tv },
      ],
    };
  },

  topTitles: (d) => ({
    kind: 'breakdown',
    entries: (d.rollup?.topTitles ?? []).map((t) => ({ label: t.title || `#${t.tmdbId}`, value: t.count })),
  }),

  topProviders: (d) => ({
    kind: 'breakdown',
    entries: (d.rollup?.topProviders ?? []).map((p) => ({ label: providerLabel(p.providerId), value: p.count })),
  }),

  topGenres: (d) => ({
    kind: 'breakdown',
    entries: (d.rollup?.topGenres ?? []).map((g) => ({ label: genreLabel(g.genreId), value: g.count })),
  }),

  ratingsHistogram: (d) => {
    const hist = d.rollup?.ratingsHistogram;
    if (!hist || hist.length === 0) return emptyBreakdown;
    // BIN-158: betyg lagras på 0.5–5-skalan (rollup avrundar till heltalsstjärna
    // → buckets 1–5). 10-bucket-arrayens index 5–9 (betyg 6–10) är alltid tomma
    // på den riktiga skalan — visa bara 1–5★. (Halvstegs-granularitet kräver en
    // ändring i rollup-funktionen → separat functions-deploy.)
    return {
      kind: 'breakdown',
      entries: hist.slice(0, 5).map((value, i) => ({ label: `${i + 1}★`, value })),
    };
  },

  advisorPauses: (d) => scalar(d.plausible?.goals.advisor_pause_taken ?? NaN),
  activeSessions: (d) => scalar(d.rollup?.totals.activeSessions ?? NaN),
  groupsCount: (d) => scalar(d.rollup?.totals.groups ?? NaN),

  // ── Trafik ──────────────────────────────────────────────────────────────────
  pageViews: (d) => scalar(d.plausible?.pageviews ?? NaN),
  visitors: (d) => scalar(d.plausible?.visitors ?? NaN),
  avgSessionDuration: (d) => scalar(d.plausible?.avgVisitDurationSec ?? NaN),

  topPages: (d) => ({
    kind: 'breakdown',
    entries: (d.plausible?.topPages ?? []).map((p) => ({ label: p.page, value: p.visitors })),
  }),

  topReferrers: (d) => ({
    kind: 'breakdown',
    entries: (d.plausible?.topReferrers ?? []).map((r) => ({ label: r.referrer, value: r.visitors })),
  }),
};
