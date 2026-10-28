import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsightsProvider } from '../state/InsightsContext';
import type { InsightsData } from '../insights.types';
import { MetricTile } from './MetricTile';
import { MIN_TREND_POINTS, TREND_NOT_FETCHED } from '../metrics/resolvers';
import { sparkSegments } from './MetricTile';

// Plan 2026-10-28 steg 3: en ögonblicksbild får en liten kurva ur de daterade beräkningarna,
// först när perioden har minst MIN_TREND_POINTS dagar (#22: tre punkter är ingen trend).
const rollup: InsightsData['rollup'] = {
  computedAt: '2026-10-28T07:40:00.000Z', readsUsed: 0, partial: false,
  totals: { users: 42, titlesTracked: 0, reviews: 0, activeSessions: 0, groups: 0 },
  statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
  mediaTypeSplit: { movie: 0, tv: 0 },
  ratingsHistogram: [], topTitles: [], topProviders: [], topGenres: [],
};

const history = (n: number): InsightsData['history'] => Array.from({ length: n }, (_, i) => ({
  date: `2026-10-${String(10 + i).padStart(2, '0')}`, users: 30 + i, titlesTracked: 0, reviews: 0,
}));

const data = (n: number): InsightsData => ({
  generatedAt: '2026-10-28T08:00:00.000Z',
  range: { preset: '30d', from: '2026-09-28', to: '2026-10-28' },
  rollup, events: null, eventsSince: null, askBinge: null, window: null, partial: false,
  history: history(n),
});

const renderTile = (d: InsightsData) =>
  render(<InsightsProvider value={{ data: d, previous: null }}><MetricTile metricKey="totalUsers" /></InsightsProvider>);

describe('MetricTile trend curve', () => {
  it('draws the curve with first and last day in its hover text, and keeps today\'s number on the tile', () => {
    renderTile(data(MIN_TREND_POINTS));
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByRole('img', { name: '2026-10-10: 30 → 2026-10-16: 36' })).toBeTruthy();
  });

  it('draws no curve under MIN_TREND_POINTS days', () => {
    renderTile(data(MIN_TREND_POINTS - 1));
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('says the curve could not be fetched when history is null, and draws nothing', () => {
    renderTile({ ...data(0), history: null });
    expect(screen.getByText(TREND_NOT_FETCHED)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('says where the curve begins when the history starts after the range', () => {
    renderTile(data(MIN_TREND_POINTS)); // range from 2026-09-28, first point 2026-10-10
    expect(screen.getByText('kurvan börjar 2026-10-10')).toBeTruthy();
  });

  it('draws no "kurvan börjar" note when the history covers the range from its first day', () => {
    const d = data(MIN_TREND_POINTS);
    renderTile({ ...d, range: { ...d.range, from: '2026-10-10' } });
    expect(screen.queryByText(/kurvan börjar/)).toBeNull();
  });

  it('breaks the line at a missing day and places x by date, not by list position', () => {
    const pts = [
      { x: '2026-10-10', y: 1 }, { x: '2026-10-11', y: 2 },
      { x: '2026-10-13', y: 3 }, { x: '2026-10-14', y: 4 }, // 12th missing
    ];
    const segs = sparkSegments(pts, 40, 10, 1, 3);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toBe('0.0,10.0 10.0,6.7');
    expect(segs[1]).toBe('30.0,3.3 40.0,0.0');
  });
});
