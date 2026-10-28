import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsightsProvider } from '../state/InsightsContext';
import type { InsightsData } from '../insights.types';
import { MetricTile } from './MetricTile';
import { MIN_TREND_POINTS } from '../metrics/resolvers';

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
});
