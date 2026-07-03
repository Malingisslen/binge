import type { MetricKey, MetricValue } from './types';
import type { InsightsData } from '../insights.types';
import { getProvider, canonicalProviderId } from '@/lib/tmdb/providers';
import { genreLabel } from '@/lib/tmdb/genreLabels';

// ── Helpers ──────────────────────────────────────────────────────────────────

const scalar = (value: number, previous?: number): MetricValue =>
  previous === undefined ? { kind: 'scalar', value } : { kind: 'scalar', value, previous };

const emptyBreakdown: MetricValue = { kind: 'breakdown', entries: [] };

// genreLabel — Swedish genre names — moved to @/lib/tmdb/genreLabels (shared
// with the library filter, BIN-44).
const providerLabel = (id: number): string => getProvider(id)?.name ?? `Tjänst ${id}`;

// The rollup stores a top-N of raw provider ids. Two clean-ups happen here so the
// panel reads as real subscription services (BIN-407):
//  1. Fold TMDB alias ids onto the canonical service and re-sum counts — a service
//     stored under several ids (Max = 384/1899/1825) would otherwise show 2-3 rows.
//     The rollup now canonicalises too, but this keeps the panel correct on a daily
//     doc written before that deploy (self-healing, no wait for the next rollup).
//  2. Drop ids not in the Swedish catalog (rent/buy leaks like Amazon Video = 10,
//     which surfaced as the bare placeholder "Tjänst 10") — this panel is titled
//     "streamingtjänster", so transactional/unmodelled ids don't belong.
const topProviderEntries = (
  raw: readonly { providerId: number; count: number }[],
): { label: string; value: number }[] => {
  const merged = new Map<number, number>();
  for (const { providerId, count } of raw) {
    const id = canonicalProviderId(providerId);
    if (!getProvider(id)) continue; // unmodelled (rent/buy/unknown) → not a "streamingtjänst"
    merged.set(id, (merged.get(id) ?? 0) + count);
  }
  return [...merged.entries()]
    .map(([id, value]) => ({ label: providerLabel(id), value }))
    .sort((a, b) => b.value - a.value);
};

// ── Fråga Binge label maps ─────────────────────────────────────────────────────
// Filter-TYPE names (telemetry.ts) → Swedish. A combo "decade+rating" renders as
// "Årtionde + Betyg" so the founder can read which combination strands users.
const ASK_FILTER_LABEL: Record<string, string> = {
  genre: 'Genre', mood: 'Känsla', runtime: 'Längd', provider: 'Tjänst',
  myProviders: 'Mina tjänster', excludeSeen: 'Osedda', rating: 'Betyg',
  decade: 'Årtionde', language: 'Språk', sort: 'Sortering',
};
const askComboLabel = (combo: string): string =>
  combo === 'none'
    ? 'Inget filter'
    : combo.split('+').map((t) => ASK_FILTER_LABEL[t] ?? t).join(' + ');

// AskFilter keys (the removable chips) → Swedish.
const ASK_CHIP_LABEL: Record<string, string> = {
  mediaType: 'Film/Serie', genreIds: 'Genre', mood: 'Känsla', runtimeMax: 'Längd',
  providerIds: 'Tjänst', myProvidersOnly: 'Mina tjänster', excludeSeen: 'Osedda',
  voteAverageMin: 'Betyg', decade: 'Årtionde', originalLanguage: 'Språk', sortBy: 'Sortering',
};

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
    entries: topProviderEntries(d.rollup?.topProviders ?? []),
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

  // ── Fråga Binge ───────────────────────────────────────────────────────────
  askSearches: (d) => scalar(d.askBinge?.searches ?? NaN),
  askZeroRate: (d) => {
    const a = d.askBinge;
    // Share of completed searches that returned nothing — the headline
    // "are people getting stranded" number. NaN (→ "–") when no searches yet.
    return scalar(a && a.searches > 0 ? Math.round((a.zeroResults / a.searches) * 100) : NaN);
  },
  askLowConfidence: (d) => scalar(d.askBinge?.lowConfidence ?? NaN),

  askResultBuckets: (d) => {
    const b = d.askBinge?.resultBuckets;
    if (!b) return emptyBreakdown;
    return {
      kind: 'breakdown',
      entries: [
        { label: 'Inga', value: b['0'] },
        { label: '1–9', value: b['1-9'] },
        { label: '10–29', value: b['10-29'] },
        { label: '30+', value: b['30+'] },
      ],
    };
  },

  askStrandingFilters: (d) => ({
    kind: 'breakdown',
    entries: (d.askBinge?.topStrandingFilters ?? []).map((c) => ({
      label: askComboLabel(c.filters),
      value: c.zero,
    })),
  }),

  askRemovedChips: (d) => ({
    kind: 'breakdown',
    entries: (d.askBinge?.topRemovedChips ?? []).map((c) => ({
      label: ASK_CHIP_LABEL[c.key] ?? c.key,
      value: c.count,
    })),
  }),

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
