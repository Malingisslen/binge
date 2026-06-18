import { describe, it, expect } from 'vitest';
import { DATA_RESOLVERS } from './resolvers';
import type { InsightsData } from '../insights.types';

function emptyData(over: Partial<InsightsData> = {}): InsightsData {
  return {
    generatedAt: '2026-06-02T00:00:00.000Z',
    range: { preset: '30d', from: '2026-05-03', to: '2026-06-02' },
    rollup: null,
    plausible: null,
    window: null,
    partial: false,
    ...over,
  };
}

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

describe('ratingsHistogram resolves to a 10-bucket breakdown labelled 1..10', () => {
  it('labels each bucket with its rating', () => {
    const d = emptyData({
      rollup: {
        computedAt: '', readsUsed: 0, partial: false,
        totals: { users: 0, titlesTracked: 0, reviews: 0, activeSessions: 0, groups: 0 },
        statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
        mediaTypeSplit: { movie: 0, tv: 0 },
        ratingsHistogram: [1, 0, 0, 0, 0, 0, 2, 1, 0, 4],
        topTitles: [], topProviders: [], topGenres: [],
      },
    });
    const v = DATA_RESOLVERS.ratingsHistogram(d);
    expect(v.kind).toBe('breakdown');
    if (v.kind !== 'breakdown') return;
    expect(v.entries).toHaveLength(10);
    expect(v.entries[0]).toEqual({ label: '1', value: 1 });
    expect(v.entries[6]).toEqual({ label: '7', value: 2 });
    expect(v.entries[9]).toEqual({ label: '10', value: 4 });
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
