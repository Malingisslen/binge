import type { MetricKey, MetricValue } from './types';
import type { HistoryPoint, InsightsData, TrafficData } from '../insights.types';
import { getProvider, canonicalProviderId } from '@/lib/tmdb/providers';
import { genreLabel } from '@/lib/tmdb/genreLabels';
import { MIN_COHORT } from '@/lib/secondWeek';

// ── Helpers ──────────────────────────────────────────────────────────────────

const scalar = (value: number, note?: string): MetricValue =>
  note === undefined ? { kind: 'scalar', value } : { kind: 'scalar', value, note };

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
  notCounted: 'Ingen räkning i intervallet',
  notMeasured: 'inte mätt',
  tooFewAccounts: 'för få konton än',
  tooFewSearches: 'för få sökningar än',
  notFetched: 'kunde inte hämtas',
} as const;

// ── Besök (Cloudflare Web Analytics) ─────────────────────────────────────────
// `traffic` är null när Cloudflare inte kunde läsas (svaret är då delvis): rutan säger
// det i stället för att visa noll. Saknas fältet helt är funktionen inte driftsatt än.
const notFetchedScalar: MetricValue = { kind: 'scalar', value: NaN, missing: MISSING.notFetched };
const notFetchedBreakdown: MetricValue = { kind: 'breakdown', entries: [], missing: MISSING.notFetched };
const notFetchedSeries: MetricValue = { kind: 'series', points: [], missing: MISSING.notFetched };
/** Ett intervall helt före beaconens första dag är inte mätt: en nolla där vore "inga besökare". */
const beforeTraffic = (d: InsightsData): string | null =>
  d.trafficSince && d.range.to < d.trafficSince ? `mätningen började ${d.trafficSince}` : null;
const trafficValue = (d: InsightsData, value: (t: TrafficData) => MetricValue, notFetched: MetricValue): MetricValue => {
  if (!d.traffic) return notFetched;
  const before = beforeTraffic(d);
  return before ? { ...notFetched, missing: before } : value(d.traffic);
};
/** Cloudflare lämnar hänvisaren tom vid direktbesök och när webbläsaren inte skickar någon. */
export const DIRECT_REFERRER_LABEL = 'Direkt eller okänd';

/** Under så här många sökningar visas ingen andel: en procent på ett par sökningar är inget mönster. */
export const MIN_SEARCHES_FOR_RATE = 10;

// ── Egen räkning (eventStats, BIN-1438) ──────────────────────────────────────
// `events` är null när intervallet saknar eventStats-dokument: inget mättes, och rutan
// visar MISSING.notCounted i stället för noll. Finns dokument räknas en händelse som
// saknas i dem som noll — den mättes och hände inte.
const notCountedScalar: MetricValue = { kind: 'scalar', value: NaN, missing: MISSING.notCounted };
const notCountedBreakdown: MetricValue = { kind: 'breakdown', entries: [], missing: MISSING.notCounted };
const notCountedSeries: MetricValue = { kind: 'series', points: [], missing: MISSING.notCounted };

const eventCount = (d: InsightsData, event: string): MetricValue =>
  d.events ? scalar(d.events.counts[event] ?? 0) : notCountedScalar;

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

// Bara dagar som HAR ett dokument blir punkter — en dag utan dokument mättes inte.
const eventSeries = (d: InsightsData, event: string): MetricValue =>
  d.events
    ? { kind: 'series', points: d.events.daily.map((p) => ({ x: p.date, y: p.counts[event] ?? 0 })) }
    : notCountedSeries;

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

// Andel av sökningarna, med antalet som rad under. Under MIN_SEARCHES_FOR_RATE sökningar
// säger rutan varför i stället för att visa en procent på tre sökningar.
const askRate = (d: InsightsData, numerator: (a: NonNullable<InsightsData['askBinge']>) => number): MetricValue => {
  const a = d.askBinge;
  if (!a || !Number.isFinite(a.searches)) return scalar(NaN);
  if (a.searches < MIN_SEARCHES_FOR_RATE) return { kind: 'scalar', value: NaN, missing: MISSING.tooFewSearches };
  const n = numerator(a);
  return scalar(Math.round((n / a.searches) * 100), `${n.toLocaleString('sv-SE')} av ${a.searches.toLocaleString('sv-SE')} sökningar`);
};

// ── Kurvor för ögonblicksbilder (history, de daterade rollup-kopiorna) ─────────
/** Under så här många dagar ritas ingen kurva: tre punkter ser ut som en trend utan att vara en. */
export const MIN_TREND_POINTS = 7;

/** Shown under the number when the curve's history could not be read (#22: never a flat or empty curve). */
export const TREND_NOT_FETCHED = 'kurvan kunde inte hämtas';

// Ögonblicksbilden kommer ur dagens rollup; kurvan ur de daterade kopiorna i intervallet.
// Dagar som saknar fältet (äldre dokument) hoppas över i stället för att ritas som noll.
// Börjar kurvan senare än intervallet (historiken är kortare) står det under talet,
// så att en kort kurva inte läses som hela perioden.
const snapshotWithTrend = (
  d: InsightsData,
  value: number | undefined,
  pick: (h: HistoryPoint) => number | undefined,
): MetricValue => {
  if (d.history === null) return scalar(value ?? NaN, TREND_NOT_FETCHED);
  const points = (d.history ?? [])
    .flatMap((h) => { const y = pick(h); return y === undefined ? [] : [{ x: h.date, y }]; });
  if (points.length < MIN_TREND_POINTS) return scalar(value ?? NaN);
  const note = points[0].x > d.range.from ? `kurvan börjar ${points[0].x}` : undefined;
  return note === undefined
    ? { kind: 'scalar', value: value ?? NaN, trend: points }
    : { kind: 'scalar', value: value ?? NaN, trend: points, note };
};

// ── DATA_RESOLVERS ─────────────────────────────────────────────────────────────

export const DATA_RESOLVERS: Record<MetricKey, (data: InsightsData) => MetricValue> = {
  // ── Just nu ───────────────────────────────────────────────────────────────
  totalUsers: (d) => snapshotWithTrend(d, d.rollup?.totals.users, (h) => h.users),
  totalTitlesTracked: (d) => snapshotWithTrend(d, d.rollup?.totals.titlesTracked, (h) => h.titlesTracked),
  totalReviews: (d) => snapshotWithTrend(d, d.rollup?.totals.reviews, (h) => h.reviews),
  // Snapshot from the latest rollup, not the picked range: Auth keeps one clock per account.
  activeUsers7d: (d) => scalar(d.rollup?.activeUsers?.d7 ?? NaN),
  activeUsers30d: (d) => snapshotWithTrend(d, d.rollup?.activeUsers?.d30, (h) => h.activeUsers30d),
  activeSessions: (d) => scalar(d.rollup?.totals.activeSessions ?? NaN),
  groupsCount: (d) => scalar(d.rollup?.totals.groups ?? NaN),

  // ── I perioden ────────────────────────────────────────────────────────────
  newUsers: (d) => scalar(Math.max(0, d.window?.deltas.users ?? NaN)),
  titlesAdded: (d) => scalar(Math.max(0, d.window?.deltas.titlesTracked ?? NaN)),
  signupsTrend: (d) => eventSeries(d, 'signed_up'),
  signins: (d) => eventCount(d, 'signed_in'),

  signinMethodSplit: (d) => eventPropBreakdown(d, 'signed_in', 'method', { google: 'Google', email: 'E-post' }),

  // Bara de som tryckte klar skickar händelsen (finish() i OnboardingFlow.tsx), så det
  // här är en fördelning av avslut, ingen tratt: ingen procent av ett första steg.
  onboardingFinishStep: (d) => {
    if (!d.events) return notCountedBreakdown;
    const byStep = d.events.props.onboarding_completed?.step_reached ?? {};
    return {
      kind: 'breakdown',
      entries: Object.entries(byStep)
        .map(([step, count]) => ({ step: Number(step), count }))
        .filter((s) => Number.isInteger(s.step) && s.count > 0)
        .sort((a, b) => a.step - b.step)
        .map((s) => ({ label: `Steg ${s.step}`, value: s.count })),
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

  // ── Engagemang ────────────────────────────────────────────────────────────
  titlesAddedTrend: (d) => eventSeries(d, 'title_added_watchlist'),

  providerClicks: (d) => eventCount(d, 'provider_clicked'),

  providerClicksByType: (d) => eventPropBreakdown(d, 'provider_clicked', 'offerType', {
    subscription: 'Abonnemang', rent: 'Hyra', buy: 'Köpa', free: 'Gratis',
  }),

  shareClicks: (d) => eventCount(d, 'share_clicked'),

  shareClicksBySurface: (d) => eventPropBreakdown(d, 'share_clicked', 'surface', {
    title: 'Titel', list: 'Lista', profile: 'Profil',
  }),

  shareClicksByMethod: (d) => eventPropBreakdown(d, 'share_clicked', 'method', {
    native: 'Telefonens delningsark', copy: 'Kopiera länk',
  }),

  priceCheckTotals: (d) => eventCount(d, 'price_check_total_shown'),

  priceCheckBySurface: (d) => eventPropBreakdown(d, 'price_check_total_shown', 'surface', {
    calculator: 'Kalkylatorn', home: 'Startsidans demo',
  }),

  priceCheckSaves: (d) => eventCount(d, 'price_check_save_clicked'),

  advisorActions: (d) => eventPropBreakdown(d, 'advisor_action_taken', 'action', {
    pause: 'Pausa', resume: 'Återuppta', subscribe: 'Skaffa', catchup: 'Komma ikapp',
  }),

  // ── Biblioteket ───────────────────────────────────────────────────────────
  statusDistribution: (d) => {
    const s = d.rollup?.statusDistribution;
    if (!s) return emptyBreakdown;
    return {
      kind: 'breakdown',
      entries: [
        { label: 'Vill se', value: s.vill_se },
        { label: 'Tittar', value: s.mina },
        { label: 'Sett', value: s.sedd },
        { label: 'Avbrutet', value: s.avbruten },
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
        { label: 'Serie', value: m.tv },
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

  // ── Fråga Binge ───────────────────────────────────────────────────────────
  askSearches: (d) => scalar(d.askBinge?.searches ?? NaN),
  askZeroRate: (d) => askRate(d, (a) => a.zeroResults),
  askLowConfidenceRate: (d) => askRate(d, (a) => a.lowConfidence),

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

  // ── Besök ─────────────────────────────────────────────────────────────────
  visits: (d) => trafficValue(d, (t) => scalar(t.visits), notFetchedScalar),
  pageViews: (d) => trafficValue(d, (t) => scalar(t.pageViews), notFetchedScalar),
  visitsTrend: (d) =>
    trafficValue(d, (t) => ({ kind: 'series', points: t.daily.map((p) => ({ x: p.date, y: p.visits })) }), notFetchedSeries),
  topPages: (d) =>
    trafficValue(d, (t) => ({ kind: 'breakdown', entries: t.topPages.map((p) => ({ label: p.path, value: p.pageViews })) }), notFetchedBreakdown),
  topReferrers: (d) =>
    trafficValue(d, (t) => ({ kind: 'breakdown', entries: t.topReferrers.map((r) => ({ label: r.host || DIRECT_REFERRER_LABEL, value: r.visits })) }), notFetchedBreakdown),
};
