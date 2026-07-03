import { describe, it, expect } from 'vitest';
import { DATA_RESOLVERS } from './resolvers';
import type { InsightsData } from '../insights.types';

function emptyData(over: Partial<InsightsData> = {}): InsightsData {
  return {
    generatedAt: '2026-06-02T00:00:00.000Z',
    range: { preset: '30d', from: '2026-05-03', to: '2026-06-02' },
    rollup: null,
    plausible: null,
    askBinge: null,
    window: null,
    partial: false,
    ...over,
  };
}

const askBingeData = (over: Partial<NonNullable<InsightsData['askBinge']>> = {}): InsightsData['askBinge'] => ({
  searches: 0, zeroResults: 0, lowConfidence: 0, chipRemovals: 0,
  resultBuckets: { '0': 0, '1-9': 0, '10-29': 0, '30+': 0 },
  topStrandingFilters: [], topRemovedChips: [], days: 0,
  ...over,
});

describe('Fråga Binge resolvers', () => {
  it('askZeroRate is the zero-result percentage, NaN with no searches', () => {
    expect(DATA_RESOLVERS.askZeroRate(emptyData())).toEqual({ kind: 'scalar', value: NaN });
    expect(DATA_RESOLVERS.askZeroRate(emptyData({ askBinge: askBingeData() }))).toEqual({ kind: 'scalar', value: NaN });
    expect(
      DATA_RESOLVERS.askZeroRate(emptyData({ askBinge: askBingeData({ searches: 20, zeroResults: 5 }) })),
    ).toEqual({ kind: 'scalar', value: 25 });
  });

  it('askStrandingFilters humanizes the filter-combo into Swedish', () => {
    const d = emptyData({
      askBinge: askBingeData({ topStrandingFilters: [{ filters: 'decade+rating', searches: 8, zero: 6 }] }),
    });
    const v = DATA_RESOLVERS.askStrandingFilters(d);
    expect(v).toEqual({ kind: 'breakdown', entries: [{ label: 'Årtionde + Betyg', value: 6 }] });
  });

  it('askRemovedChips maps AskFilter keys to Swedish chip labels', () => {
    const d = emptyData({
      askBinge: askBingeData({ topRemovedChips: [{ key: 'originalLanguage', count: 5 }, { key: 'genreIds', count: 3 }] }),
    });
    const v = DATA_RESOLVERS.askRemovedChips(d);
    expect(v).toEqual({
      kind: 'breakdown',
      entries: [{ label: 'Språk', value: 5 }, { label: 'Genre', value: 3 }],
    });
  });
});

describe('scalar resolvers fall back to NaN when their source is missing', () => {
  it('totalUsers is NaN with no rollup, the value with a rollup', () => {
    expect(DATA_RESOLVERS.totalUsers(emptyData())).toEqual({ kind: 'scalar', value: NaN });
    const d = emptyData({
      rollup: {
        computedAt: '', readsUsed: 0, partial: false,
        totals: { users: 42, titlesTracked: 0, reviews: 0, activeSessions: 0, groups: 0 },
        statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
        mediaTypeSplit: { movie: 0, tv: 0 },
        ratingsHistogram: [], topTitles: [], topProviders: [], topGenres: [],
      },
    });
    expect(DATA_RESOLVERS.totalUsers(d)).toEqual({ kind: 'scalar', value: 42 });
  });

  it('avgSessionDuration is NaN with no plausible bundle', () => {
    expect(DATA_RESOLVERS.avgSessionDuration(emptyData())).toEqual({ kind: 'scalar', value: NaN });
  });
});

describe('statusDistribution resolves to a Swedish-labelled breakdown', () => {
  it('maps the four statuses to labels in fixed order', () => {
    const d = emptyData({
      rollup: {
        computedAt: '', readsUsed: 0, partial: false,
        totals: { users: 0, titlesTracked: 0, reviews: 0, activeSessions: 0, groups: 0 },
        statusDistribution: { vill_se: 5, mina: 3, sedd: 9, avbruten: 1 },
        mediaTypeSplit: { movie: 0, tv: 0 },
        ratingsHistogram: [], topTitles: [], topProviders: [], topGenres: [],
      },
    });
    expect(DATA_RESOLVERS.statusDistribution(d)).toEqual({
      kind: 'breakdown',
      entries: [
        { label: 'Vill se', value: 5 },
        { label: 'Mina', value: 3 },
        { label: 'Sedd', value: 9 },
        { label: 'Avbruten', value: 1 },
      ],
    });
  });
});

describe('onboardingFunnel builds funnel steps with pctOfStart', () => {
  it('orders by step and computes pct relative to the first step', () => {
    const d = emptyData({
      plausible: {
        visitors: 0, pageviews: 0, avgVisitDurationSec: 0, bounceRatePct: 0,
        visitorsTimeseries: [], topPages: [], topReferrers: [],
        goals: { signed_up: 0, title_added_watchlist: 0, review_created: 0, advisor_pause_taken: 0, donate_clicked: 0 },
        signupsTimeseries: [],
        onboardingFunnel: [{ step: 3, count: 20 }, { step: 1, count: 100 }, { step: 2, count: 50 }],
        signinMethodSplit: { google: 0, email: 0 },
      },
    });
    const v = DATA_RESOLVERS.onboardingFunnel(d);
    expect(v.kind).toBe('funnel');
    if (v.kind !== 'funnel') return;
    expect(v.steps.map((s) => s.count)).toEqual([100, 50, 20]);
    expect(v.steps.map((s) => s.pctOfStart)).toEqual([100, 50, 20]);
  });

  it('is an empty funnel when plausible is missing', () => {
    expect(DATA_RESOLVERS.onboardingFunnel(emptyData())).toEqual({ kind: 'funnel', steps: [] });
  });
});

describe('ratingsHistogram resolves to a 5-star breakdown labelled 1★..5★ (BIN-158)', () => {
  it('shows only the real 1–5★ buckets and drops the always-empty 6–10 tail', () => {
    const d = emptyData({
      rollup: {
        computedAt: '', readsUsed: 0, partial: false,
        totals: { users: 0, titlesTracked: 0, reviews: 0, activeSessions: 0, groups: 0 },
        statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
        mediaTypeSplit: { movie: 0, tv: 0 },
        // 10-slot rollup array; slots 5–9 (ratings 6–10) are impossible on the
        // 0.5–5 scale and must be dropped from the displayed histogram.
        ratingsHistogram: [3, 1, 2, 5, 4, 0, 0, 0, 0, 0],
        topTitles: [], topProviders: [], topGenres: [],
      },
    });
    const v = DATA_RESOLVERS.ratingsHistogram(d);
    expect(v.kind).toBe('breakdown');
    if (v.kind !== 'breakdown') return;
    expect(v.entries).toHaveLength(5);
    expect(v.entries[0]).toEqual({ label: '1★', value: 3 });
    expect(v.entries[4]).toEqual({ label: '5★', value: 4 });
  });
});

describe('topProviders folds alias ids and drops unmodelled services (BIN-407)', () => {
  const rollupWith = (topProviders: { providerId: number; count: number }[]): InsightsData =>
    emptyData({
      rollup: {
        computedAt: '', readsUsed: 0, partial: false,
        totals: { users: 0, titlesTracked: 0, reviews: 0, activeSessions: 0, groups: 0 },
        statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
        mediaTypeSplit: { movie: 0, tv: 0 },
        ratingsHistogram: [], topTitles: [], topProviders, topGenres: [],
      },
    });

  it('merges a service stored under several TMDB ids into one row with summed count', () => {
    // Max = 384 (base) + 1899 (legacy HBO Max) + 1825 (Amazon channel).
    const v = DATA_RESOLVERS.topProviders(rollupWith([
      { providerId: 384, count: 45 },
      { providerId: 1899, count: 41 },
      { providerId: 1825, count: 26 },
    ]));
    expect(v).toEqual({ kind: 'breakdown', entries: [{ label: 'Max', value: 112 }] });
  });

  it('drops ids not in the Swedish catalog (no more "Tjänst 10" placeholder)', () => {
    const v = DATA_RESOLVERS.topProviders(rollupWith([
      { providerId: 8, count: 82 },   // Netflix — kept
      { providerId: 10, count: 30 },  // Amazon Video (rent) — unmodelled, dropped
    ]));
    expect(v).toEqual({ kind: 'breakdown', entries: [{ label: 'Netflix', value: 82 }] });
  });

  it('re-sorts by merged count so the fold cannot leave rows out of order', () => {
    // Netflix inserted FIRST so map insertion order is wrong until the sort runs —
    // Max only overtakes after its two alias parts merge (30 + 40 = 70 > 50).
    const v = DATA_RESOLVERS.topProviders(rollupWith([
      { providerId: 8, count: 50 },    // Netflix
      { providerId: 384, count: 30 },  // Max part 1
      { providerId: 1899, count: 40 }, // Max part 2 → Max total 70 > Netflix 50
    ]));
    expect(v).toEqual({ kind: 'breakdown', entries: [{ label: 'Max', value: 70 }, { label: 'Netflix', value: 50 }] });
  });
});

describe('period metrics read window deltas and floor at 0', () => {
  it('newUsers and titlesAdded are NaN when window is null', () => {
    expect(DATA_RESOLVERS.newUsers(emptyData())).toEqual({ kind: 'scalar', value: NaN });
    expect(DATA_RESOLVERS.titlesAdded(emptyData())).toEqual({ kind: 'scalar', value: NaN });
  });

  it('reads the net deltas from window', () => {
    const d = emptyData({ window: { basisDate: '2026-06-11', truncated: false, deltas: { users: 2, titlesTracked: 19 } } });
    expect(DATA_RESOLVERS.newUsers(d)).toEqual({ kind: 'scalar', value: 2 });
    expect(DATA_RESOLVERS.titlesAdded(d)).toEqual({ kind: 'scalar', value: 19 });
  });

  it('floors a negative net delta to 0 (never a minus under an "added" label)', () => {
    const d = emptyData({ window: { basisDate: '2026-06-11', truncated: false, deltas: { users: 0, titlesTracked: -2 } } });
    expect(DATA_RESOLVERS.titlesAdded(d)).toEqual({ kind: 'scalar', value: 0 });
  });
});
