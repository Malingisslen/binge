import { describe, it, expect } from 'vitest';
import { DATA_RESOLVERS, MISSING } from './resolvers';
import type { InsightsData } from '../insights.types';

function emptyData(over: Partial<InsightsData> = {}): InsightsData {
  return {
    generatedAt: '2026-06-02T00:00:00.000Z',
    range: { preset: '30d', from: '2026-05-03', to: '2026-06-02' },
    rollup: null,
    events: null,
    eventsSince: null,
    askBinge: null,
    window: null,
    partial: false,
    ...over,
  };
}

const eventsData = (over: Partial<NonNullable<InsightsData['events']>> = {}): InsightsData['events'] => ({
  counts: {}, props: {}, daily: [], days: 1,
  ...over,
});

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

  it('web-traffic metrics say "Ingen källa" even when events were counted', () => {
    const d = emptyData({ events: eventsData({ counts: { signed_up: 3 } }) });
    for (const key of ['avgSessionDuration', 'pageViews'] as const) {
      expect(DATA_RESOLVERS[key](d), key).toEqual({ kind: 'scalar', value: NaN, missing: 'Ingen källa' });
    }
    for (const key of ['topPages', 'topReferrers', 'signupLandingPages'] as const) {
      expect(DATA_RESOLVERS[key](d), key).toEqual({ kind: 'breakdown', entries: [], missing: 'Ingen källa' });
    }
  });

  it('the three missing reasons read differently from each other', () => {
    expect(new Set(Object.values(MISSING)).size).toBe(Object.keys(MISSING).length);
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
      events: eventsData({ props: { onboarding_completed: { step_reached: { '3': 20, '1': 100, '2': 50 } } } }),
    });
    const v = DATA_RESOLVERS.onboardingFunnel(d);
    expect(v.kind).toBe('funnel');
    if (v.kind !== 'funnel') return;
    expect(v.steps.map((s) => s.name)).toEqual(['Steg 1', 'Steg 2', 'Steg 3']);
    expect(v.steps.map((s) => s.count)).toEqual([100, 50, 20]);
    expect(v.steps.map((s) => s.pctOfStart)).toEqual([100, 50, 20]);
  });

  it('says "Ingen räkning i intervallet" when nothing was counted', () => {
    expect(DATA_RESOLVERS.onboardingFunnel(emptyData()))
      .toEqual({ kind: 'funnel', steps: [], missing: 'Ingen räkning i intervallet' });
  });

  it('is an empty funnel with no missing reason when days were counted but no step reached', () => {
    expect(DATA_RESOLVERS.onboardingFunnel(emptyData({ events: eventsData() }))).toEqual({ kind: 'funnel', steps: [] });
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
    // HBO Max = 384 (base) + 1899 (legacy id) + 1825 (Amazon channel).
    const v = DATA_RESOLVERS.topProviders(rollupWith([
      { providerId: 384, count: 45 },
      { providerId: 1899, count: 41 },
      { providerId: 1825, count: 26 },
    ]));
    expect(v).toEqual({ kind: 'breakdown', entries: [{ label: 'HBO Max', value: 112 }] });
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
    // HBO Max only overtakes after its two alias parts merge (30 + 40 = 70 > 50).
    const v = DATA_RESOLVERS.topProviders(rollupWith([
      { providerId: 8, count: 50 },    // Netflix
      { providerId: 384, count: 30 },  // HBO Max part 1
      { providerId: 1899, count: 40 }, // HBO Max part 2 → total 70 > Netflix 50
    ]));
    expect(v).toEqual({ kind: 'breakdown', entries: [{ label: 'HBO Max', value: 70 }, { label: 'Netflix', value: 50 }] });
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

describe('Delning och mätning resolvers', () => {
  const rollupWith = (activeUsers?: { d7: number; d30: number }): InsightsData['rollup'] => ({
    computedAt: '', readsUsed: 0, partial: false,
    totals: { users: 3, titlesTracked: 0, reviews: 0, activeSessions: 0, groups: 0 },
    ...(activeUsers ? { activeUsers } : {}),
    statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
    mediaTypeSplit: { movie: 0, tv: 0 },
    ratingsHistogram: [], topTitles: [], topProviders: [], topGenres: [],
  });
  it('active users read the rollup snapshot, and are NaN on a rollup written before the field', () => {
    const d = emptyData({ rollup: rollupWith({ d7: 2, d30: 3 }) });
    expect(DATA_RESOLVERS.activeUsers7d(d)).toEqual({ kind: 'scalar', value: 2 });
    expect(DATA_RESOLVERS.activeUsers30d(d)).toEqual({ kind: 'scalar', value: 3 });
    expect(DATA_RESOLVERS.activeUsers7d(emptyData({ rollup: rollupWith() }))).toEqual({ kind: 'scalar', value: NaN });
  });

  it('secondWeekReturn splits the cohort, hides a cohort under five, and says not measured on an older rollup (BIN-1442)', () => {
    const withReturn = (r: { returned: number; cohort: number }) =>
      emptyData({ rollup: { ...rollupWith()!, secondWeekReturn: r } });
    expect(DATA_RESOLVERS.secondWeekReturn(withReturn({ returned: 2, cohort: 5 }))).toEqual({
      kind: 'breakdown',
      entries: [{ label: 'Kom tillbaka', value: 2 }, { label: 'Kom inte tillbaka', value: 3 }],
    });
    expect(DATA_RESOLVERS.secondWeekReturn(withReturn({ returned: 4, cohort: 4 })))
      .toEqual({ kind: 'breakdown', entries: [], missing: 'för få konton än' });
    expect(DATA_RESOLVERS.secondWeekReturn(emptyData({ rollup: rollupWith() })))
      .toEqual({ kind: 'breakdown', entries: [], missing: 'inte mätt' });
  });

  it('providerClicks is not-counted when nothing was counted, 0 when counted days lack the event', () => {
    expect(DATA_RESOLVERS.providerClicks(emptyData()))
      .toEqual({ kind: 'scalar', value: NaN, missing: 'Ingen räkning i intervallet' });
    expect(DATA_RESOLVERS.providerClicks(emptyData({ events: eventsData() }))).toEqual({ kind: 'scalar', value: 0 });
    const d = emptyData({ events: eventsData({ counts: { provider_clicked: 7 } }) });
    expect(DATA_RESOLVERS.providerClicks(d)).toEqual({ kind: 'scalar', value: 7 });
  });

  it('providerClicksByType labels offer types in Swedish, largest first', () => {
    const d = emptyData({ events: eventsData({ props: { provider_clicked: { offerType: { rent: 2, subscription: 9 } } } }) });
    expect(DATA_RESOLVERS.providerClicksByType(d)).toEqual({
      kind: 'breakdown',
      entries: [{ label: 'Abonnemang', value: 9 }, { label: 'Hyra', value: 2 }],
    });
  });
});

describe('eventStats resolvers (BIN-1438) — inte mätt är aldrig noll', () => {
  it('every event-backed metric says "Ingen räkning i intervallet" when the range has no eventStats docs', () => {
    const missing = 'Ingen räkning i intervallet';
    for (const key of ['providerClicks', 'shareClicks', 'priceCheckTotals', 'priceCheckSaves', 'advisorPauses'] as const) {
      expect(DATA_RESOLVERS[key](emptyData()), key).toEqual({ kind: 'scalar', value: NaN, missing });
    }
    for (const key of ['signinMethodSplit', 'providerClicksByType', 'shareClicksBySurface'] as const) {
      expect(DATA_RESOLVERS[key](emptyData()), key).toEqual({ kind: 'breakdown', entries: [], missing });
    }
    expect(DATA_RESOLVERS.signupsTrend(emptyData())).toEqual({ kind: 'series', points: [], missing });
  });

  it('a counted range carries no missing reason — a zero is a measured zero', () => {
    const d = emptyData({ events: eventsData() });
    for (const key of ['providerClicks', 'shareClicks', 'priceCheckTotals', 'priceCheckSaves', 'advisorPauses'] as const) {
      expect(DATA_RESOLVERS[key](d), key).toEqual({ kind: 'scalar', value: 0 });
    }
  });

  it('donateClicks reads "inte mätt" even with counted days — donate_clicked has no call site', () => {
    const d = emptyData({ events: eventsData({ counts: { donate_clicked: 4 } }) });
    expect(DATA_RESOLVERS.donateClicks(d)).toEqual({ kind: 'scalar', value: NaN, missing: 'inte mätt' });
  });

  it('advisorPauses reads advisor_action_taken with action=pause, not other actions', () => {
    const d = emptyData({
      events: eventsData({ props: { advisor_action_taken: { action: { pause: 3, resume: 5 } } } }),
    });
    expect(DATA_RESOLVERS.advisorPauses(d)).toEqual({ kind: 'scalar', value: 3 });
  });

  it('signinMethodSplit reads the method prop of signed_in', () => {
    const d = emptyData({ events: eventsData({ props: { signed_in: { method: { google: 4, email: 1 } } } }) });
    expect(DATA_RESOLVERS.signinMethodSplit(d)).toEqual({
      kind: 'breakdown',
      entries: [{ label: 'Google', value: 4 }, { label: 'E-post', value: 1 }],
    });
  });

  it('signupsTrend has a point per day WITH a doc only — a missing day is not a 0', () => {
    const d = emptyData({
      events: eventsData({
        daily: [
          { date: '2026-10-01', counts: { signed_up: 2 } },
          { date: '2026-10-03', counts: { provider_clicked: 1 } },
        ],
        days: 2,
      }),
    });
    expect(DATA_RESOLVERS.signupsTrend(d)).toEqual({
      kind: 'series',
      points: [{ x: '2026-10-01', y: 2 }, { x: '2026-10-03', y: 0 }],
    });
  });

  it('share and price-check tiles read their own events', () => {
    const d = emptyData({
      events: eventsData({
        counts: { share_clicked: 6, price_check_total_shown: 9, price_check_save_clicked: 2 },
        props: { share_clicked: { surface: { list: 1, title: 5 } } },
      }),
    });
    expect(DATA_RESOLVERS.shareClicks(d)).toEqual({ kind: 'scalar', value: 6 });
    expect(DATA_RESOLVERS.priceCheckTotals(d)).toEqual({ kind: 'scalar', value: 9 });
    expect(DATA_RESOLVERS.priceCheckSaves(d)).toEqual({ kind: 'scalar', value: 2 });
    expect(DATA_RESOLVERS.shareClicksBySurface(d)).toEqual({
      kind: 'breakdown',
      entries: [{ label: 'Titel', value: 5 }, { label: 'Lista', value: 1 }],
    });
  });
});
