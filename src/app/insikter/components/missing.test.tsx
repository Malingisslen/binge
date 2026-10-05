import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { InsightsProvider } from '../state/InsightsContext';
import type { InsightsData } from '../insights.types';
import { MetricTile } from './MetricTile';
import { TopList } from './TopList';
import { Donut } from './Donut';
import { Funnel } from './Funnel';
import { TimeSeriesChart } from './TimeSeriesChart';
import { Toolbar } from './Toolbar';

// BIN-1438 / #26: ett mått som inte mäts ska stå med sitt skäl, aldrig som "–", "0" eller
// "Ingen data" — annars läses frånvaro av mätning som frånvaro av händelser.
const data = (over: Partial<InsightsData> = {}): InsightsData => ({
  generatedAt: '2026-10-05T00:00:00.000Z',
  range: { preset: '30d', from: '2026-09-05', to: '2026-10-05' },
  rollup: null,
  events: null,
  eventsSince: null,
  askBinge: null,
  window: null,
  partial: false,
  ...over,
});

const withData = (d: InsightsData, ui: ReactNode) => render(<InsightsProvider value={d}>{ui}</InsightsProvider>);

describe('Insikter renders why a value is missing', () => {
  it('a no-source breakdown and scalar read "Ingen källa"', () => {
    withData(data(), <><TopList metricKey="topPages" /><MetricTile metricKey="pageViews" /></>);
    expect(screen.getAllByText('Ingen källa')).toHaveLength(2);
    expect(screen.queryByText('Ingen data')).toBeNull();
    expect(screen.queryByText('–')).toBeNull();
  });

  it('event breakdowns, the funnel and the trend read "Ingen räkning i intervallet" when nothing was counted', () => {
    withData(data(), <>
      <Donut metricKey="providerClicksByType" />
      <Donut metricKey="shareClicksBySurface" />
      <Donut metricKey="signinMethodSplit" />
      <Funnel metricKey="onboardingFunnel" />
      <TimeSeriesChart metricKey="signupsTrend" />
    </>);
    expect(screen.getAllByText('Ingen räkning i intervallet')).toHaveLength(5);
    expect(screen.queryByText(/totalt/)).toBeNull();
  });

  it('donateClicks reads "inte mätt", and an event tile carries the unit "händelser"', () => {
    withData(data(), <MetricTile metricKey="donateClicks" />);
    expect(screen.getByText('inte mätt')).toBeTruthy();
    expect(screen.getByText('händelser')).toBeTruthy();
  });

  it('a counted zero is shown as 0, not as a missing reason', () => {
    withData(data({ events: { counts: {}, props: {}, daily: [], days: 1 } }), <MetricTile metricKey="providerClicks" />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText('Ingen räkning i intervallet')).toBeNull();
  });

  it('the toolbar says "mäts sedan" when the range starts before the first counted day', () => {
    withData(data({ eventsSince: '2026-10-01' }), <Toolbar lastFetchedAt={null} />);
    expect(screen.getByText('Händelser mäts sedan 2026-10-01')).toBeTruthy();
  });
});
