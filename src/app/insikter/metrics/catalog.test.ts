import { describe, it, expect } from 'vitest';
import { METRICS, METRIC_KEYS } from './catalog';
import { DATA_RESOLVERS } from './resolvers';
import type { InsightsData } from '../insights.types';

// BIN-1438 / #26: händelseräkningen räknar händelser, inte personer eller besök. En etikett
// med "besök" på ett händelsemått lovar något källan inte kan mäta.
describe('event-based metric labels', () => {
  const eventKeys = METRIC_KEYS.filter((k) => METRICS[k].source === 'events');

  it('the event-based roster is exactly the eventStats metrics of the catalog', () => {
    expect([...eventKeys].sort()).toEqual([
      'advisorActions', 'onboardingFinishStep', 'priceCheckBySurface', 'priceCheckSaves',
      'priceCheckTotals', 'providerClicks', 'providerClicksByType', 'shareClicks',
      'shareClicksByMethod', 'shareClicksBySurface', 'signinMethodSplit', 'signins',
      'signupsTrend', 'titlesAddedTrend',
    ]);
  });

  it.each(eventKeys)('%s has no "besök" in its label', (key) => {
    expect(METRICS[key].label.toLowerCase()).not.toContain('besök');
  });
});

describe('snapshot and comparable flags', () => {
  it('no metric is both snapshot and comparable (a snapshot ignores the picker, so has no previous period)', () => {
    expect(METRIC_KEYS.filter((k) => METRICS[k].snapshot && METRICS[k].comparable)).toEqual([]);
  });

  const comparableKeys = METRIC_KEYS.filter((k) => METRICS[k].comparable);

  it('the comparable roster is the period sums', () => {
    expect([...comparableKeys].sort()).toEqual([
      'newUsers', 'priceCheckSaves', 'priceCheckTotals', 'providerClicks', 'shareClicks', 'signins', 'titlesAdded',
    ]);
  });

  const empty: InsightsData = {
    generatedAt: '2026-10-09T00:00:00.000Z',
    range: { preset: '7d', from: '2026-10-01', to: '2026-10-08' },
    rollup: null, events: null, eventsSince: null, askBinge: null, window: null, partial: false,
  };
  const withEvents: InsightsData = { ...empty, events: { counts: {}, props: {}, daily: [], days: 1 } };

  it.each(comparableKeys)('%s resolves to a scalar on empty data and on events data', (key) => {
    expect(DATA_RESOLVERS[key](empty).kind).toBe('scalar');
    expect(DATA_RESOLVERS[key](withEvents).kind).toBe('scalar');
  });
});
