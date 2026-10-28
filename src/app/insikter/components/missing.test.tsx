import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { InsightsProvider } from '../state/InsightsContext';
import type { InsightsData } from '../insights.types';
import { MetricTile } from './MetricTile';
import { TopList } from './TopList';
import { Donut } from './Donut';
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

const withData = (d: InsightsData, ui: ReactNode) =>
  render(<InsightsProvider value={{ data: d, previous: null }}>{ui}</InsightsProvider>);

const askBinge = (over: Partial<NonNullable<InsightsData['askBinge']>>): InsightsData['askBinge'] => ({
  searches: 0, zeroResults: 0, lowConfidence: 0, chipRemovals: 0,
  resultBuckets: { '0': 0, '1-9': 0, '10-29': 0, '30+': 0 },
  topStrandingFilters: [], topRemovedChips: [], days: 1,
  ...over,
});

describe('Insikter renders why a value is missing', () => {
  it('event breakdowns, lists and trends read "Ingen räkning i intervallet" when nothing was counted', () => {
    withData(data(), <>
      <Donut metricKey="providerClicksByType" />
      <Donut metricKey="shareClicksBySurface" />
      <Donut metricKey="signinMethodSplit" />
      <TopList metricKey="onboardingFinishStep" />
      <TimeSeriesChart metricKey="signupsTrend" />
      <TimeSeriesChart metricKey="titlesAddedTrend" />
    </>);
    expect(screen.getAllByText('Ingen räkning i intervallet')).toHaveLength(6);
    expect(screen.queryByText(/totalt/)).toBeNull();
    expect(screen.queryByText('Ingen data')).toBeNull();
  });

  it('an event tile with nothing counted reads the reason and still carries the unit "händelser"', () => {
    withData(data(), <MetricTile metricKey="signins" />);
    expect(screen.getByText('Ingen räkning i intervallet')).toBeTruthy();
    expect(screen.getByText('händelser')).toBeTruthy();
  });

  it('askLowConfidenceRate under 10 searches reads "för få sökningar än", not a percentage', () => {
    withData(data({ askBinge: askBinge({ searches: 3, lowConfidence: 1 }) }), <MetricTile metricKey="askLowConfidenceRate" />);
    expect(screen.getByText('för få sökningar än')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('askZeroRate from 10 searches shows the percentage and the count behind it as a note', () => {
    withData(data({ askBinge: askBinge({ searches: 20, zeroResults: 5 }) }), <MetricTile metricKey="askZeroRate" />);
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('5 av 20 sökningar')).toBeTruthy();
  });

  it('secondWeekReturn reads "inte mätt" before the rollup carries it', () => {
    withData(data(), <Donut metricKey="secondWeekReturn" />);
    expect(screen.getByText('inte mätt')).toBeTruthy();
  });

  it('a counted zero is shown as 0, not as a missing reason', () => {
    withData(data({ events: { counts: {}, props: {}, daily: [], days: 1 } }), <MetricTile metricKey="providerClicks" />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText('Ingen räkning i intervallet')).toBeNull();
  });
});

describe('Toolbar', () => {
  const rollupAt = (computedAt: Date): InsightsData['rollup'] => ({
    computedAt: computedAt.toISOString(), readsUsed: 0, partial: false,
    totals: { users: 1, titlesTracked: 0, reviews: 0, activeSessions: 0, groups: 0 },
    statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
    mediaTypeSplit: { movie: 0, tv: 0 },
    ratingsHistogram: [], topTitles: [], topProviders: [], topGenres: [],
  });
  const HOUR = 3_600_000;
  // Local-time constructors: the toolbar speaks the viewer's calendar day.
  const computed = new Date(2026, 9, 28, 9, 40);

  it('says "mäts sedan" when the range starts before the first counted day', () => {
    withData(data({ eventsSince: '2026-10-01' }), <Toolbar lastFetchedAt={null} />);
    expect(screen.getByText('Händelser mäts sedan 2026-10-01')).toBeTruthy();
  });

  it('says "har inte räknats än" when no counting has begun', () => {
    withData(data(), <Toolbar lastFetchedAt={null} />);
    expect(screen.getByText('Händelser har inte räknats än')).toBeTruthy();
  });

  it('names tomorrow when the next run (computedAt + 24 h) falls on another day than the fetch', () => {
    withData(data({ rollup: rollupAt(computed) }), <Toolbar lastFetchedAt={new Date(2026, 9, 28, 20, 40)} />);
    expect(screen.getByText(/nästa uppdatering ungefär imorgon 09:40/)).toBeTruthy();
  });

  it('names today when the next run falls on the fetch day', () => {
    const yesterdayEvening = new Date(2026, 9, 27, 20, 0);
    withData(data({ rollup: rollupAt(yesterdayEvening) }), <Toolbar lastFetchedAt={new Date(2026, 9, 28, 10, 0)} />);
    expect(screen.getByText(/nästa uppdatering ungefär i dag 20:00/)).toBeTruthy();
  });

  it('says the update is expected today when it passed less than 30 h ago (26 h since computedAt)', () => {
    withData(data({ rollup: rollupAt(computed) }), <Toolbar lastFetchedAt={new Date(computed.getTime() + 26 * HOUR)} />);
    expect(screen.getByText(/nästa uppdatering väntas i dag/)).toBeTruthy();
    expect(screen.queryByText(/försenad/)).toBeNull();
  });

  it('says the update is late after 30 h (31 h since computedAt)', () => {
    withData(data({ rollup: rollupAt(computed) }), <Toolbar lastFetchedAt={new Date(computed.getTime() + 31 * HOUR)} />);
    expect(screen.getByText(/uppdateringen är försenad/)).toBeTruthy();
    expect(screen.queryByText(/väntas i dag/)).toBeNull();
  });

  it('always tells that today\'s numbers arrive with the next calculation', () => {
    const { unmount } = withData(data({ rollup: rollupAt(computed) }), <Toolbar lastFetchedAt={new Date(2026, 9, 28, 20, 40)} />);
    expect(screen.getByText('Dagens siffror fylls på till nästa beräkning')).toBeTruthy();
    unmount();
    withData(data(), <Toolbar lastFetchedAt={null} />);
    expect(screen.getByText('Dagens siffror fylls på till nästa beräkning')).toBeTruthy();
  });
});
