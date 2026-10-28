import { describe, it, expect } from 'vitest';
import { DATA_RESOLVERS, MISSING, MIN_TREND_POINTS } from './resolvers';
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
  it('askZeroRate and askLowConfidenceRate say "för få sökningar än" under 10 searches, even with no askBinge counts', () => {
    const missing = { kind: 'scalar', value: NaN, missing: 'för få sökningar än' };
    for (const key of ['askZeroRate', 'askLowConfidenceRate'] as const) {
      expect(DATA_RESOLVERS[key](emptyData({ askBinge: askBingeData() })), key).toEqual(missing);
      expect(DATA_RESOLVERS[key](emptyData({ askBinge: askBingeData({ searches: 9, zeroResults: 9, lowConfidence: 9 }) })), key).toEqual(missing);
    }
  });

  it('from 10 searches the rate is a percent with the count behind it as a note', () => {
    const d = emptyData({ askBinge: askBingeData({ searches: 10, zeroResults: 1, lowConfidence: 4 }) });
    expect(DATA_RESOLVERS.askZeroRate(d)).toEqual({ kind: 'scalar', value: 10, note: '1 av 10 sökningar' });
    expect(DATA_RESOLVERS.askLowConfidenceRate(d)).toEqual({ kind: 'scalar', value: 40, note: '4 av 10 sökningar' });
    const d2 = emptyData({ askBinge: askBingeData({ searches: 20, zeroResults: 5 }) });
    expect(DATA_RESOLVERS.askZeroRate(d2)).toEqual({ kind: 'scalar', value: 25, note: '5 av 20 sökningar' });
  });

  it('with no askBinge at all the rates are NaN without a reason (the read failed, nothing is claimed)', () => {
    expect(DATA_RESOLVERS.askZeroRate(emptyData())).toEqual({ kind: 'scalar', value: NaN });
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

  it('the missing reasons read differently from each other', () => {
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
        { label: 'Tittar', value: 3 },
        { label: 'Sett', value: 9 },
        { label: 'Avbrutet', value: 1 },
      ],
    });
  });
});

describe('onboardingFinishStep is a distribution of finishes, not a funnel', () => {
  it('is a breakdown sorted by step number, with the raw count and no percent', () => {
    const d = emptyData({
      events: eventsData({ props: { onboarding_completed: { step_reached: { '3': 20, '1': 100, '2': 50, '10': 1 } } } }),
    });
    expect(DATA_RESOLVERS.onboardingFinishStep(d)).toEqual({
      kind: 'breakdown',
      entries: [
        { label: 'Steg 1', value: 100 }, { label: 'Steg 2', value: 50 },
        { label: 'Steg 3', value: 20 }, { label: 'Steg 10', value: 1 },
      ],
    });
  });

  it('says "Ingen räkning i intervallet" when nothing was counted', () => {
    expect(DATA_RESOLVERS.onboardingFinishStep(emptyData()))
      .toEqual({ kind: 'breakdown', entries: [], missing: 'Ingen räkning i intervallet' });
  });

  it('is an empty breakdown with no missing reason when days were counted but nobody finished', () => {
    expect(DATA_RESOLVERS.onboardingFinishStep(emptyData({ events: eventsData() }))).toEqual({ kind: 'breakdown', entries: [] });
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
  const NOT_COUNTED = 'Ingen räkning i intervallet';

  it('every event-backed metric says "Ingen räkning i intervallet" when the range has no eventStats docs', () => {
    for (const key of ['signins', 'providerClicks', 'shareClicks', 'priceCheckTotals', 'priceCheckSaves'] as const) {
      expect(DATA_RESOLVERS[key](emptyData()), key).toEqual({ kind: 'scalar', value: NaN, missing: NOT_COUNTED });
    }
    for (const key of [
      'signinMethodSplit', 'onboardingFinishStep', 'providerClicksByType', 'shareClicksBySurface',
      'shareClicksByMethod', 'priceCheckBySurface', 'advisorActions',
    ] as const) {
      expect(DATA_RESOLVERS[key](emptyData()), key).toEqual({ kind: 'breakdown', entries: [], missing: NOT_COUNTED });
    }
  });

  it('signupsTrend and titlesAddedTrend read missing "Ingen räkning i intervallet" when events is null', () => {
    for (const key of ['signupsTrend', 'titlesAddedTrend'] as const) {
      expect(DATA_RESOLVERS[key](emptyData()), key).toEqual({ kind: 'series', points: [], missing: NOT_COUNTED });
    }
  });

  it('a counted range carries no missing reason — a zero is a measured zero', () => {
    const d = emptyData({ events: eventsData() });
    for (const key of ['signins', 'providerClicks', 'shareClicks', 'priceCheckTotals', 'priceCheckSaves'] as const) {
      expect(DATA_RESOLVERS[key](d), key).toEqual({ kind: 'scalar', value: 0 });
    }
  });

  it('signins counts signed_in', () => {
    const d = emptyData({ events: eventsData({ counts: { signed_in: 8, signed_up: 3 } }) });
    expect(DATA_RESOLVERS.signins(d)).toEqual({ kind: 'scalar', value: 8 });
  });

  it('advisorActions labels the action prop of advisor_action_taken, largest first, ignoring unknown actions', () => {
    const d = emptyData({
      events: eventsData({ props: { advisor_action_taken: { action: { pause: 3, resume: 5, subscribe: 1, other: 9 } } } }),
    });
    expect(DATA_RESOLVERS.advisorActions(d)).toEqual({
      kind: 'breakdown',
      entries: [{ label: 'Återuppta', value: 5 }, { label: 'Pausa', value: 3 }, { label: 'Skaffa', value: 1 }],
    });
  });

  it('signinMethodSplit reads the method prop of signed_in', () => {
    const d = emptyData({ events: eventsData({ props: { signed_in: { method: { google: 4, email: 1 } } } }) });
    expect(DATA_RESOLVERS.signinMethodSplit(d)).toEqual({
      kind: 'breakdown',
      entries: [{ label: 'Google', value: 4 }, { label: 'E-post', value: 1 }],
    });
  });

  it('shareClicksByMethod and priceCheckBySurface read their own props', () => {
    const d = emptyData({
      events: eventsData({
        props: {
          share_clicked: { method: { copy: 2, native: 7 } },
          price_check_total_shown: { surface: { home: 1, calculator: 6 } },
        },
      }),
    });
    expect(DATA_RESOLVERS.shareClicksByMethod(d)).toEqual({
      kind: 'breakdown',
      entries: [{ label: 'Telefonens delningsark', value: 7 }, { label: 'Kopiera länk', value: 2 }],
    });
    expect(DATA_RESOLVERS.priceCheckBySurface(d)).toEqual({
      kind: 'breakdown',
      entries: [{ label: 'Kalkylatorn', value: 6 }, { label: 'Startsidans demo', value: 1 }],
    });
  });

  it('signupsTrend and titlesAddedTrend have a point per day WITH a doc only — a missing day is not a 0', () => {
    const d = emptyData({
      events: eventsData({
        daily: [
          { date: '2026-10-01', counts: { signed_up: 2, title_added_watchlist: 5 } },
          { date: '2026-10-03', counts: { provider_clicked: 1 } },
        ],
        days: 2,
      }),
    });
    expect(DATA_RESOLVERS.signupsTrend(d)).toEqual({
      kind: 'series',
      points: [{ x: '2026-10-01', y: 2 }, { x: '2026-10-03', y: 0 }],
    });
    expect(DATA_RESOLVERS.titlesAddedTrend(d)).toEqual({
      kind: 'series',
      points: [{ x: '2026-10-01', y: 5 }, { x: '2026-10-03', y: 0 }],
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

describe('kurvor för ögonblicksbilder (history, steg 3)', () => {
  const base: InsightsData = emptyData({
    rollup: {
      computedAt: '2026-06-02T00:00:00.000Z',
      totals: { users: 42, titlesTracked: 2000, reviews: 17, activeSessions: 0, groups: 0 },
      activeUsers: { d7: 5, d30: 30 },
      statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
      mediaTypeSplit: { movie: 0, tv: 0 },
      ratingsHistogram: Array(10).fill(0),
      topTitles: [], topProviders: [], topGenres: [], readsUsed: 0, partial: false,
    },
  });
  const day = (i: number) => `2026-10-${String(10 + i).padStart(2, '0')}`;
  const points = (n: number) => Array.from({ length: n }, (_, i) => ({
    date: day(i), users: 100 + i, titlesTracked: 1000 + i, reviews: 10 + i, activeUsers7d: 5, activeUsers30d: 20 + i,
  }));

  it('ritar en kurva för Användare, Titlar, Recensioner och Aktiva 30 d när perioden har minst MIN_TREND_POINTS dagar', () => {
    const d = { ...base, history: points(MIN_TREND_POINTS) };
    for (const key of ['totalUsers', 'totalTitlesTracked', 'totalReviews', 'activeUsers30d'] as const) {
      const v = DATA_RESOLVERS[key](d);
      expect(v.kind).toBe('scalar');
      if (v.kind !== 'scalar') return;
      expect(v.trend).toHaveLength(MIN_TREND_POINTS);
      expect(v.trend?.[0]).toEqual({ x: day(0), y: expect.any(Number) });
    }
    const users = DATA_RESOLVERS.totalUsers(d);
    expect(users.kind === 'scalar' && users.trend?.map((p) => p.y)).toEqual([100, 101, 102, 103, 104, 105, 106]);
  });

  it('ritar ingen kurva under MIN_TREND_POINTS dagar, utan history eller när läsningen misslyckades', () => {
    for (const history of [points(MIN_TREND_POINTS - 1), [], null, undefined]) {
      const v = DATA_RESOLVERS.totalUsers({ ...base, history });
      expect(v.kind === 'scalar' && v.trend).toBeUndefined();
    }
  });

  it('talet på rutan kommer fortfarande ur dagens rollup, inte ur kurvans sista punkt', () => {
    const v = DATA_RESOLVERS.totalUsers({ ...base, history: points(MIN_TREND_POINTS) });
    expect(v.kind === 'scalar' && v.value).toBe(base.rollup?.totals.users);
  });

  it('en dag utan aktiva-fält hoppas över i stället för att bli noll', () => {
    const history = points(MIN_TREND_POINTS + 1).map((h, i) => (i === 0 ? { date: h.date, users: h.users, titlesTracked: h.titlesTracked, reviews: h.reviews } : h));
    const v = DATA_RESOLVERS.activeUsers30d({ ...base, history });
    expect(v.kind === 'scalar' && v.trend?.length).toBe(MIN_TREND_POINTS);
    expect(v.kind === 'scalar' && v.trend?.[0].x).toBe(day(1));
  });

  it('Aktiva 7 d och de andra ögonblicksbilderna får ingen kurva', () => {
    const d = { ...base, history: points(MIN_TREND_POINTS) };
    for (const key of ['activeUsers7d', 'activeSessions', 'groupsCount'] as const) {
      const v = DATA_RESOLVERS[key](d);
      expect(v.kind === 'scalar' && v.trend).toBeUndefined();
    }
  });
});
