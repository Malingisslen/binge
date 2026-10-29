import { describe, it, expect } from 'vitest';
import { compare, previousRange, previousWindowProblem, SMALL_BASE } from './comparison';
import { METRICS } from './catalog';
import { DATA_RESOLVERS } from './resolvers';
import type { InsightsData } from '../insights.types';

const data = (over: Partial<InsightsData> = {}): InsightsData => ({
  generatedAt: '2026-10-09T00:00:00.000Z',
  range: { preset: 'custom', from: '2026-09-23', to: '2026-09-30' },
  rollup: null,
  events: { counts: { provider_clicked: 10 }, props: {}, daily: [], days: 8 },
  eventsSince: '2026-09-01',
  askBinge: null,
  window: null,
  partial: false,
  ...over,
});

describe('previousRange', () => {
  it('gives an equally long window ending the day before the current one starts', () => {
    expect(previousRange({ preset: '7d', from: '2026-10-01', to: '2026-10-08' }))
      .toEqual({ preset: 'custom', from: '2026-09-23', to: '2026-09-30' });
  });

  it('keeps the length for a one-day window', () => {
    expect(previousRange({ preset: '24h', from: '2026-10-08', to: '2026-10-08' }))
      .toEqual({ preset: 'custom', from: '2026-10-07', to: '2026-10-07' });
  });

  it('crosses a month and a year boundary', () => {
    expect(previousRange({ preset: '30d', from: '2026-01-01', to: '2026-01-10' }))
      .toEqual({ preset: 'custom', from: '2025-12-22', to: '2025-12-31' });
  });

  it('is null for a custom range', () => {
    expect(previousRange({ preset: 'custom', from: '2026-10-01', to: '2026-10-08' })).toBeNull();
  });
});

describe('previousWindowProblem', () => {
  const eventsDef = METRICS.providerClicks;
  const current = data({ range: { preset: '7d', from: '2026-10-01', to: '2026-10-08' } });
  const currentWin = data({
    range: { preset: '7d', from: '2026-10-01', to: '2026-10-08' },
    window: { basisDate: '2026-10-01', truncated: false, deltas: { users: 15, titlesTracked: 0 } },
  });

  it('allows the boundary day: previous.from equal to eventsSince', () => {
    const previous = data({ range: { preset: 'custom', from: '2026-09-23', to: '2026-09-30' }, eventsSince: '2026-09-23' });
    expect(previousWindowProblem(eventsDef, current, previous)).toBeNull();
  });

  it('refuses one day earlier than eventsSince and names the start date', () => {
    const previous = data({ range: { preset: 'custom', from: '2026-09-23', to: '2026-09-30' }, eventsSince: '2026-09-24' });
    expect(previousWindowProblem(eventsDef, current, previous)).toBe('ingen jämförelse: mätningen började 2026-09-24');
  });

  it('refuses when the previous window could not be fetched, fully or at all', () => {
    expect(previousWindowProblem(eventsDef, current, null)).toContain('kunde inte hämtas');
    expect(previousWindowProblem(eventsDef, current, data({ partial: true }))).toContain('kunde inte hämtas helt');
  });

  // BIN-1458: a tile is judged on its own source. The matrix lists every source
  // against an event tile and a rollup-window tile.
  it('an event tile refuses only when the events source failed, whatever else did', () => {
    for (const other of ['rollup', 'history', 'traffic'] as const) {
      expect(previousWindowProblem(eventsDef, current, data({ partial: true, failed: [other] })), other).toBeNull();
    }
    expect(previousWindowProblem(eventsDef, current, data({ partial: true, failed: ['events'] }))).toContain('kunde inte hämtas helt');
  });

  it('a rollup-window tile refuses only when the rollup source failed', () => {
    const ok = { basisDate: '2026-09-23', truncated: false, deltas: { users: 4, titlesTracked: 0 } };
    for (const other of ['events', 'history', 'traffic'] as const) {
      expect(previousWindowProblem(METRICS.newUsers, currentWin, data({ window: ok, partial: true, failed: [other] })), other).toBeNull();
    }
    expect(previousWindowProblem(METRICS.newUsers, currentWin, data({ window: ok, partial: true, failed: ['rollup'] }))).toContain('kunde inte hämtas helt');
  });

  it('an older function response without the source list falls back to the blanket flag', () => {
    expect(previousWindowProblem(eventsDef, current, data({ partial: true, failed: undefined }))).toContain('kunde inte hämtas helt');
    expect(previousWindowProblem(eventsDef, current, data({ partial: false, failed: undefined }))).toBeNull();
  });

  it('refuses an event metric when the previous window has no event counts', () => {
    expect(previousWindowProblem(eventsDef, current, data({ events: null }))).toBe('ingen jämförelse: förra perioden är inte räknad');
  });

  it('a rollup-window metric (newUsers) is unavailable when the previous window is truncated, with its basis date', () => {
    const previous = data({ window: { basisDate: '2026-09-27', truncated: true, deltas: { users: 4, titlesTracked: 0 } } });
    expect(previousWindowProblem(METRICS.newUsers, currentWin, previous)).toBe('ingen jämförelse: historiken börjar 2026-09-27');
  });

  it('a rollup-window metric is unavailable without any window, and fine with an untruncated one', () => {
    expect(previousWindowProblem(METRICS.newUsers, currentWin, data({ window: null }))).toContain('ingen historik');
    const ok = data({ window: { basisDate: '2026-09-23', truncated: false, deltas: { users: 4, titlesTracked: 0 } } });
    expect(previousWindowProblem(METRICS.newUsers, currentWin, ok)).toBeNull();
  });

  it('a rollup-window metric needs the CURRENT window untruncated too, and a baseline between the periods', () => {
    const previous = data({ window: { basisDate: '2026-09-23', truncated: false, deltas: { users: 25, titlesTracked: 0 } } });
    const truncatedCurrent = data({ ...currentWin, window: { basisDate: '2026-10-03', truncated: true, deltas: { users: 15, titlesTracked: 0 } } });
    expect(previousWindowProblem(METRICS.newUsers, truncatedCurrent, previous)).toBe('ingen jämförelse: historiken börjar 2026-10-03');
    const sameBaseline = data({ ...currentWin, window: { basisDate: '2026-09-23', truncated: false, deltas: { users: 25, titlesTracked: 0 } } });
    expect(previousWindowProblem(METRICS.newUsers, sameBaseline, previous)).toBe('ingen jämförelse: ingen beräkning mellan perioderna');
  });
});

describe('compare', () => {
  const value = (previous: InsightsData | null | undefined, current: InsightsData) =>
    compare(METRICS.providerClicks, DATA_RESOLVERS.providerClicks(current), previous ? DATA_RESOLVERS.providerClicks(previous) : { kind: 'scalar', value: NaN }, current, previous);
  const withClicks = (n: number, preset: InsightsData['range']['preset'] = '7d') =>
    data({ range: { preset, from: '2026-10-01', to: '2026-10-08' }, events: { counts: { provider_clicked: n }, props: {}, daily: [], days: 8 } });

  it('is null (no line at all) while the previous window is not fetched yet, and for a custom range', () => {
    expect(value(undefined, withClicks(30))).toBeNull();
    expect(value(withClicks(10), withClicks(30, 'custom'))).toBeNull();
  });

  it("a rollup-window metric's previous value is the difference between the two start-to-today deltas", () => {
    // Server deltas run from each window's start to TODAY (computeWindowDeltas ignores `to`):
    // previous window grew 25 − 15 = 10, current grew 15 → ▲ 5.
    const current = data({ range: { preset: '7d', from: '2026-10-01', to: '2026-10-08' }, window: { basisDate: '2026-10-01', truncated: false, deltas: { users: 15, titlesTracked: 0 } } });
    const previous = data({ window: { basisDate: '2026-09-24', truncated: false, deltas: { users: 25, titlesTracked: 0 } } });
    const wrongIfUsed = DATA_RESOLVERS.newUsers(previous); // 25: the naive previous value the bug read
    expect(compare(METRICS.newUsers, DATA_RESOLVERS.newUsers(current), wrongIfUsed, current, previous)).toEqual({ kind: 'delta', delta: 5 });
  });

  it('is a delta from the small-base limit up, current minus previous', () => {
    expect(value(withClicks(SMALL_BASE), withClicks(SMALL_BASE + 5))).toEqual({ kind: 'delta', delta: 5 });
    expect(value(withClicks(SMALL_BASE), withClicks(SMALL_BASE - 4))).toEqual({ kind: 'delta', delta: -4 });
    expect(value(withClicks(SMALL_BASE), withClicks(SMALL_BASE))).toEqual({ kind: 'delta', delta: 0 });
  });

  it('shows both numbers when the previous value is under the small-base limit', () => {
    expect(value(withClicks(SMALL_BASE - 1), withClicks(30))).toEqual({ kind: 'both', current: 30, previous: SMALL_BASE - 1 });
  });

  it('is unavailable, never a delta, when the previous window was not fetched', () => {
    const c = value(null, withClicks(30));
    expect(c?.kind).toBe('unavailable');
  });

  it('is unavailable when either value is missing', () => {
    const c = value(withClicks(10), data({ range: { preset: '7d', from: '2026-10-01', to: '2026-10-08' }, events: null }));
    expect(c).toEqual({ kind: 'unavailable', reason: 'ingen jämförelse: ett av värdena saknas' });
  });

  it('is null for a snapshot metric even with a previous window', () => {
    expect(compare(METRICS.totalUsers, { kind: 'scalar', value: 5 }, { kind: 'scalar', value: 4 }, withClicks(1), data())).toBeNull();
  });
});

describe('previousWindowProblem for traffic metrics (Cloudflare Web Analytics)', () => {
  const current = data({ range: { preset: '7d', from: '2026-10-01', to: '2026-10-08' } });
  const traffic = { visits: 1, pageViews: 1, daily: [], topPages: [], topReferrers: [] };

  it('refuses when the previous period has no traffic, and ignores the event counter entirely', () => {
    expect(previousWindowProblem(METRICS.visits, current, data({ traffic: null, events: null })))
      .toBe('ingen jämförelse: förra periodens besök kunde inte hämtas');
    expect(previousWindowProblem(METRICS.pageViews, current, data({ events: null })))
      .toBe('ingen jämförelse: förra periodens besök kunde inte hämtas');
  });

  it('is fine with traffic present, even when the previous period has no event counts', () => {
    expect(previousWindowProblem(METRICS.visits, current, data({ traffic, events: null, eventsSince: null }))).toBeNull();
  });

  it('is fine with traffic present even when the previous period is partial for another reason', () => {
    expect(previousWindowProblem(METRICS.visits, current, data({ traffic, partial: true }))).toBeNull();
    expect(previousWindowProblem(METRICS.visits, current, data({ traffic, partial: true, failed: ['rollup', 'events', 'history'] }))).toBeNull();
    expect(previousWindowProblem(METRICS.providerClicks, current, data({ traffic, partial: true }))).toContain('kunde inte hämtas helt');
  });

  it('refuses, naming the first counted day, when either window starts before the beacon went live', () => {
    const previous = data({ traffic, range: { preset: 'custom', from: '2026-09-23', to: '2026-09-30' } });
    const since = (from: string) => data({ traffic, trafficSince: '2026-09-24', range: { preset: '7d', from, to: '2026-10-08' } });
    expect(previousWindowProblem(METRICS.visits, since('2026-10-01'), previous)).toBe('ingen jämförelse: mätningen började 2026-09-24');
    expect(previousWindowProblem(METRICS.visits, since('2026-09-20'), data({ ...previous, range: { preset: 'custom', from: '2026-09-24', to: '2026-09-30' } })))
      .toBe('ingen jämförelse: mätningen började 2026-09-24');
    // Boundary day allowed on both sides: previous starting on it, and current starting on it.
    expect(previousWindowProblem(METRICS.visits, since('2026-10-01'), data({ ...previous, range: { preset: 'custom', from: '2026-09-24', to: '2026-09-30' } }))).toBeNull();
    expect(previousWindowProblem(METRICS.visits, since('2026-09-24'), data({ ...previous, range: { preset: 'custom', from: '2026-09-24', to: '2026-09-30' } }))).toBeNull();
    // The date may come from the previous response alone (current from an older deploy).
    const older = data({ traffic, range: { preset: '7d', from: '2026-09-20', to: '2026-10-08' } });
    expect(previousWindowProblem(METRICS.visits, older, data({ ...previous, trafficSince: '2026-09-24' }))).toBe('ingen jämförelse: mätningen började 2026-09-24');
  });
});
