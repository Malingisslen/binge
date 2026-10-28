import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { InsightsProvider } from '../state/InsightsContext';
import type { InsightsData } from '../insights.types';
import { MetricTile } from './MetricTile';
import { Donut } from './Donut';
import { Histogram } from './Histogram';
import { TimeSeriesChart } from './TimeSeriesChart';
import { TopList } from './TopList';
import { ExplainDrawer } from './ExplainDrawer';

const data: InsightsData = {
  generatedAt: '2026-10-09T00:00:00.000Z',
  range: { preset: '7d', from: '2026-10-01', to: '2026-10-08' },
  rollup: null,
  events: {
    counts: {}, props: {}, days: 2,
    daily: [
      { date: '2026-10-01', counts: { signed_up: 2 } },
      { date: '2026-10-08', counts: { signed_up: 5 } },
    ],
  },
  eventsSince: '2026-09-01',
  askBinge: null,
  window: null,
  partial: false,
};

const show = (ui: ReactNode) =>
  render(<InsightsProvider value={{ data, previous: null }}>{ui}</InsightsProvider>);

afterEach(() => window.history.replaceState({}, '', '/'));

describe('every metric card is explainable', () => {
  it('each card type carries a "?" button', () => {
    show(<>
      <MetricTile metricKey="providerClicks" />
      <Donut metricKey="signinMethodSplit" />
      <TopList metricKey="topTitles" />
      <Histogram metricKey="ratingsHistogram" />
      <TimeSeriesChart metricKey="signupsTrend" />
    </>);
    expect(screen.getAllByLabelText(/vad mäter det här\?$/)).toHaveLength(5);
  });

  it('the title row of a chart card opens the drawer for that metric', () => {
    show(<><TimeSeriesChart metricKey="signupsTrend" /><ExplainDrawer /></>);
    fireEvent.click(screen.getByLabelText('Registreringar per dag – vad mäter det här?'));
    expect(window.location.search).toBe('?metric=signupsTrend');
    expect(screen.getByRole('dialog', { name: 'Registreringar per dag' })).toBeTruthy();
    expect(screen.getByText('Vad är det?')).toBeTruthy();
  });

  it('a snapshot card is tagged "just nu", a period card is not', () => {
    show(<><MetricTile metricKey="totalUsers" /><MetricTile metricKey="signins" /></>);
    expect(screen.getAllByText('just nu')).toHaveLength(1);
  });
});

describe('TimeSeriesChart', () => {
  it('labels both ends of the x-axis with d MMM and gives each point a hover title', () => {
    const { container } = show(<TimeSeriesChart metricKey="signupsTrend" />);
    expect(screen.getByText(/1 okt/, { selector: 'span' })).toBeTruthy();
    expect(screen.getByText(/8 okt/, { selector: 'span' })).toBeTruthy();
    const titles = [...container.querySelectorAll('svg title')].map((t) => t.textContent ?? '');
    expect(titles).toHaveLength(2);
    expect(titles[0]).toMatch(/^1 okt\.?: 2$/);
    expect(titles[1]).toMatch(/^8 okt\.?: 5$/);
    expect(screen.getByText('7 totalt')).toBeTruthy();
  });
});

describe('ExplainDrawer with an unknown ?metric= key', () => {
  it('renders nothing instead of crashing on a bookmark to a removed metric', () => {
    window.history.replaceState({}, '', '/insikter?metric=donateClicks');
    render(<ExplainDrawer />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
