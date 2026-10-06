import type { MetricKey, MetricValue } from './types';
import type { InsightsData } from '../insights.types';
import { getProvider, canonicalProviderId } from '@/lib/tmdb/providers';
import { genreLabel } from '@/lib/tmdb/genreLabels';
import { MIN_COHORT } from '@/lib/secondWeek';

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

// Varför ett värde saknas. Komponenterna visar texten i stället för "–"/"Ingen data", så
// att ett mått som inte mäts aldrig ser ut som noll eller som en tom lista.
export const MISSING = {
  noSource: 'Ingen källa',
  notCounted: 'Ingen räkning i intervallet',
  notMeasured: 'inte mätt',
  tooFewAccounts: 'för få konton än',
} as const;

// ── Egen räkning (eventStats, BIN-1438) ──────────────────────────────────────
// `events` är null när intervallet saknar eventStats-dokument: inget mättes, och rutan
// visar MISSING.notCounted i stället för noll. Finns dokument räknas en händelse som
// saknas i dem som noll — den mättes och hände inte.
const notCountedScalar: MetricValue = { kind: 'scalar', value: NaN, missing: MISSING.notCounted };
const notCountedBreakdown: MetricValue = { kind: 'breakdown', entries: [], missing: MISSING.notCounted };

const eventCount = (d: InsightsData, event: string): MetricValue =>
  d.events ? scalar(d.events.counts[event] ?? 0) : notCountedScalar;

const eventPropCount = (d: InsightsData, event: string, prop: string, value: string): number =>
  d.events?.props[event]?.[prop]?.[value] ?? 0;

const eventPropBreakdown = (
  d: InsightsData, event: string, prop: string, labels: Record<string, string>,
): MetricValue => {
  if (!d.events) return notCountedBreakdown;
  const byValue = d.events.props[event]?.[prop] ?? {};
  return {
    kind: 'breakdown',
    entries: Object.entries(labels)
      .map(([value, label]) => ({ label, value: byValue[value] ?? 0 }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value),
  };
};

// Rena webbtrafikmått saknar källa: Binge räknar händelser, inte besök.
const noSource = (): MetricValue => ({ kind: 'scalar', value: NaN, missing: MISSING.noSource });
const noSourceBreakdown = (): MetricValue => ({ kind: 'breakdown', entries: [], missing: MISSING.noSource });

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
  titlesAdded: (d) => scalar(Math.max(0, d.window?.deltas.titlesTracked ?? NaN)),
  // Snapshot from the latest rollup, not the picked range: Auth keeps one clock per account.
  activeUsers7d: (d) => scalar(d.rollup?.activeUsers?.d7 ?? NaN),
  activeUsers30d: (d) => scalar(d.rollup?.activeUsers?.d30 ?? NaN),

  // ── Tillväxt ──────────────────────────────────────────────────────────────
  signupsTrend: (d) => (!d.events ? { kind: 'series', points: [], missing: MISSING.notCounted } : {
    kind: 'series',
    // Bara dagar som HAR ett dokument blir punkter — en dag utan dokument mättes inte.
    points: (d.events?.daily ?? []).map((p) => ({ x: p.date, y: p.counts.signed_up ?? 0 })),
  }),

  onboardingFunnel: (d) => {
    if (!d.events) return { kind: 'funnel', steps: [], missing: MISSING.notCounted };
    const byStep = d.events?.props.onboarding_completed?.step_reached ?? {};
    const steps = Object.entries(byStep)
      .map(([step, count]) => ({ step: Number(step), count }))
      .filter((s) => Number.isInteger(s.step))
      .sort((a, b) => a.step - b.step);
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

  // BIN-1442: snapshot from the latest rollup, like activeUsers. Under MIN_COHORT
  // accounts a split would point at individuals, so the tile says so instead.
  secondWeekReturn: (d) => {
    const r = d.rollup?.secondWeekReturn;
    if (!r) return { kind: 'breakdown', entries: [], missing: MISSING.notMeasured };
    if (r.cohort < MIN_COHORT) return { kind: 'breakdown', entries: [], missing: MISSING.tooFewAccounts };
    return {
      kind: 'breakdown',
      entries: [
        { label: 'Kom tillbaka', value: r.returned },
        { label: 'Kom inte tillbaka', value: r.cohort - r.returned },
      ],
    };
  },

  signinMethodSplit: (d) => {
    if (!d.events) return notCountedBreakdown;
    return {
      kind: 'breakdown',
      entries: [
        { label: 'Google', value: eventPropCount(d, 'signed_in', 'method', 'google') },
        { label: 'E-post', value: eventPropCount(d, 'signed_in', 'method', 'email') },
      ],
    };
  },

  // donate_clicked har ingen anropsplats i appen och räknas inte.
  donateClicks: () => ({ kind: 'scalar', value: NaN, missing: MISSING.notMeasured }),

  // Landningssidor är webbtrafik — ingen källa.
  signupLandingPages: noSourceBreakdown,

  providerClicks: (d) => eventCount(d, 'provider_clicked'),

  providerClicksByType: (d) => eventPropBreakdown(d, 'provider_clicked', 'offerType', {
    subscription: 'Abonnemang', rent: 'Hyra', buy: 'Köpa', free: 'Gratis',
  }),

  shareClicks: (d) => eventCount(d, 'share_clicked'),

  shareClicksBySurface: (d) => eventPropBreakdown(d, 'share_clicked', 'surface', {
    title: 'Titel', list: 'Lista', profile: 'Profil',
  }),

  priceCheckTotals: (d) => eventCount(d, 'price_check_total_shown'),
  priceCheckSaves: (d) => eventCount(d, 'price_check_save_clicked'),

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

  advisorPauses: (d) => (d.events ? scalar(eventPropCount(d, 'advisor_action_taken', 'action', 'pause')) : notCountedScalar),
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
  pageViews: noSource,
  avgSessionDuration: noSource,
  topPages: noSourceBreakdown,
  topReferrers: noSourceBreakdown,
};
