import { describe, it, expect } from 'vitest';
import type { InsightsData } from '../insights.types';
import { overallHealth, sectionHealth } from './health';

const base = {
  generatedAt: '2026-11-09T08:00:00Z',
  range: { from: '2026-10-10', to: '2026-11-09', preset: '30d' },
  rollup: { computedAt: '2026-11-09T03:00:00Z', partial: false },
  events: { counts: {}, props: {}, daily: [], days: 30 },
  eventsSince: '2026-10-01',
  askBinge: { searches: 0 },
  window: null,
  history: [],
  traffic: { visits: 0, pageViews: 0, daily: [], topPages: [], topReferrers: [] },
  partial: false,
} as unknown as InsightsData;

describe('sectionHealth', () => {
  it('is all green for fresh, complete data', () => {
    expect(overallHealth(base).ok).toBe(true);
  });
  it('marks sections yellow when their source failed', () => {
    const d = { ...base, traffic: null } as InsightsData;
    expect(sectionHealth(d, 'traffic').ok).toBe(false);
    expect(sectionHealth(d, 'now').ok).toBe(true);
  });
  it('treats events before the first counted day as normal', () => {
    const d = { ...base, events: null, eventsSince: null } as InsightsData;
    expect(sectionHealth(d, 'engagement').ok).toBe(true);
  });
  it('flags a rollup that missed its daily run', () => {
    const d = { ...base, rollup: { ...base.rollup!, computedAt: '2026-11-07T00:00:00Z' } } as InsightsData;
    expect(overallHealth(d).problems.map((p) => p.section)).toEqual(['now', 'period', 'library']);
  });
  it('uses the fetch time, like the toolbar, when given', () => {
    expect(sectionHealth(base, 'now', new Date('2026-11-11T00:00:00Z')).ok).toBe(false);
  });
  it('flags failed[] sources and a partial rollup in every rollup-fed section', () => {
    expect(sectionHealth({ ...base, failed: ['events'] } as InsightsData, 'engagement').ok).toBe(false);
    const d = { ...base, rollup: { ...base.rollup!, partial: true } } as InsightsData;
    expect(overallHealth(d).problems.map((p) => p.section)).toEqual(['now', 'period', 'library']);
  });
});
