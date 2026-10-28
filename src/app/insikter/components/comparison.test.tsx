import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { InsightsProvider } from '../state/InsightsContext';
import type { InsightsData } from '../insights.types';
import { MetricTile } from './MetricTile';

// Plan 2026-10-28 (#22): "mot förra perioden" is a neutral absolute difference, shown only
// when the previous window was fully measured; small bases show both numbers, no arrow.
const base = (over: Partial<InsightsData> = {}): InsightsData => ({
  generatedAt: '2026-10-09T00:00:00.000Z',
  range: { preset: '7d', from: '2026-10-01', to: '2026-10-08' },
  rollup: null,
  events: null,
  eventsSince: '2026-09-01',
  askBinge: null,
  window: null,
  partial: false,
  ...over,
});

const clicks = (n: number): InsightsData['events'] => ({ counts: { provider_clicked: n }, props: {}, daily: [], days: 8 });

const previousWith = (n: number, over: Partial<InsightsData> = {}): InsightsData =>
  base({ range: { preset: 'custom', from: '2026-09-23', to: '2026-09-30' }, events: clicks(n), ...over });

const renderTile = (current: InsightsData, previous: InsightsData | null | undefined, ui: ReactNode) =>
  render(<InsightsProvider value={{ data: current, previous }}>{ui}</InsightsProvider>);

describe('MetricTile comparison against the previous period', () => {
  it('shows "▲ 5 mot förra perioden" when this period is 5 above a previous count of 10', () => {
    renderTile(base({ events: clicks(15) }), previousWith(10), <MetricTile metricKey="providerClicks" />);
    expect(screen.getByText('▲ 5 mot förra perioden')).toBeTruthy();
  });

  it('shows "▼ 5 mot förra perioden" when this period is 5 below', () => {
    renderTile(base({ events: clicks(10) }), previousWith(15), <MetricTile metricKey="providerClicks" />);
    expect(screen.getByText('▼ 5 mot förra perioden')).toBeTruthy();
  });

  it('is neutral: never a green or red colour class, whichever way it moves', () => {
    renderTile(base({ events: clicks(15) }), previousWith(10), <MetricTile metricKey="providerClicks" />);
    const cls = screen.getByText('▲ 5 mot förra perioden').className;
    expect(cls).toContain('text-ink-2');
    expect(cls).not.toMatch(/green|red|success|danger/);
  });

  it('shows "±0 mot förra perioden" only when both periods were fetched and are equal', () => {
    renderTile(base({ events: clicks(15) }), previousWith(15), <MetricTile metricKey="providerClicks" />);
    expect(screen.getByText('±0 mot förra perioden')).toBeTruthy();
  });

  it('under the small-base limit shows both numbers without an arrow', () => {
    renderTile(base({ events: clicks(4) }), previousWith(2), <MetricTile metricKey="providerClicks" />);
    expect(screen.getByText('förra perioden: 2')).toBeTruthy();
    expect(screen.queryByText(/▲|▼|±0/)).toBeNull();
  });

  it('does not claim ±0 when the previous period could not be fetched, and says why', () => {
    renderTile(base({ events: clicks(15) }), null, <MetricTile metricKey="providerClicks" />);
    expect(screen.getByText('ingen jämförelse: förra perioden kunde inte hämtas')).toBeTruthy();
    expect(screen.queryByText(/±0/)).toBeNull();
    expect(screen.queryByText(/▲|▼/)).toBeNull();
  });

  it('says the measurement began later when the previous window starts before the first counted day', () => {
    const previous = previousWith(10, { eventsSince: '2026-09-25' });
    renderTile(base({ events: clicks(15) }), previous, <MetricTile metricKey="providerClicks" />);
    expect(screen.getByText('ingen jämförelse: mätningen började 2026-09-25')).toBeTruthy();
    expect(screen.queryByText(/mot förra perioden/)).toBeNull();
  });

  it('a snapshot tile gets no comparison line even with a previous period present', () => {
    const rollup: InsightsData['rollup'] = {
      computedAt: '2026-10-08T00:00:00.000Z', readsUsed: 0, partial: false,
      totals: { users: 42, titlesTracked: 0, reviews: 0, activeSessions: 0, groups: 0 },
      statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
      mediaTypeSplit: { movie: 0, tv: 0 },
      ratingsHistogram: [], topTitles: [], topProviders: [], topGenres: [],
    };
    renderTile(base({ rollup }), previousWith(10, { rollup }), <MetricTile metricKey="totalUsers" />);
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.queryByText(/förra perioden|ingen jämförelse/)).toBeNull();
  });

  it('a rollup-window metric (newUsers) reads the previous growth as the difference between the two start-to-today deltas', () => {
    // The server's deltas run from the window start to TODAY, so the previous window's delta
    // (25) covers both periods; its own growth is 25 − 15 = 10 → ▲ 5.
    const win = (basisDate: string, users: number): InsightsData['window'] => ({ basisDate, truncated: false, deltas: { users, titlesTracked: 0 } });
    renderTile(base({ window: win('2026-10-01', 15) }), previousWith(0, { events: null, window: win('2026-09-24', 25) }), <MetricTile metricKey="newUsers" />);
    expect(screen.getByText('▲ 5 mot förra perioden')).toBeTruthy();
  });

  it('shows no comparison line at all while the previous window is still being fetched', () => {
    renderTile(base({ events: clicks(15) }), undefined, <MetricTile metricKey="providerClicks" />);
    expect(screen.queryByText(/förra perioden|ingen jämförelse/)).toBeNull();
  });

  it('shows no comparison line for a custom range, instead of claiming a failed fetch', () => {
    renderTile(base({ events: clicks(15), range: { preset: 'custom', from: '2026-10-01', to: '2026-10-08' } }), null, <MetricTile metricKey="providerClicks" />);
    expect(screen.queryByText(/förra perioden|ingen jämförelse/)).toBeNull();
  });

  it('a tile that has no number because nothing was counted does not add a comparison reason', () => {
    renderTile(base({ events: null }), null, <MetricTile metricKey="providerClicks" />);
    expect(screen.getByText('Ingen räkning i intervallet')).toBeTruthy();
    expect(screen.queryByText(/ingen jämförelse/)).toBeNull();
  });
});
