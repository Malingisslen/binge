import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ListPlan } from '@/lib/advisor/listOptimizer';
import type { UseListCheapestPlanResult } from '@/hooks/useListCheapestPlan';

// Mock the data hook + auth so we render the panel against fixed plan states —
// this test is about the RENDER logic (honesty of what's shown), not the fan-out.
const mockUseListCheapestPlan = vi.fn<() => UseListCheapestPlanResult>();
const mockUseAuth = vi.fn<() => { uid: string | null }>();

vi.mock('@/hooks/useListCheapestPlan', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListCheapestPlan: () => mockUseListCheapestPlan(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

import ListCheapestPlanPanel from './ListCheapestPlanPanel';

const items = [
  { tmdbId: 1, mediaType: 'movie' as const, title: 'A' },
  { tmdbId: 2, mediaType: 'tv' as const, title: 'B' },
  { tmdbId: 3, mediaType: 'movie' as const, title: 'C' },
];

const basePlan: ListPlan = {
  totalTitles: 3,
  // 2 stream, 1 is non-streamable-but-rentable → an optimizer-consistent shape
  // (rentCount derives only from non-streamable titles).
  streamableCount: 2,
  bestSingle: {
    providerId: 8, // Netflix
    providerName: 'Netflix',
    monthlyKr: 169,
    coveredCount: 2,
    remainder: [],
    rentCount: 1,
    unavailableCount: 0,
  },
  fullPlan: {
    serviceIds: [8, 384], // Netflix + Max
    monthlyKr: 318,
    streamableCovered: 3,
    rentCount: 1,
    unavailableCount: 0,
  },
  naiveMonthlyKr: 400,
  savingKr: 82,
};

function result(over: Partial<UseListCheapestPlanResult>): UseListCheapestPlanResult {
  return { plan: null, isLoading: false, hasError: false, uncheckableCount: 0, ...over };
}

beforeEach(() => {
  mockUseAuth.mockReturnValue({ uid: 'u1' });
  mockUseListCheapestPlan.mockReset();
});

describe('ListCheapestPlanPanel (BIN-416)', () => {
  it('renders nothing for a logged-out viewer', () => {
    mockUseAuth.mockReturnValue({ uid: null });
    mockUseListCheapestPlan.mockReturnValue(result({ plan: basePlan }));
    const { container } = render(<ListCheapestPlanPanel items={items} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows best-single headline + bundle + saving, and JustWatch credit', () => {
    mockUseListCheapestPlan.mockReturnValue(result({ plan: basePlan }));
    render(<ListCheapestPlanPanel items={items} />);
    expect(screen.getByText('Billigaste sättet att se listan')).toBeInTheDocument();
    // Netflix legitimately appears twice: best-single headline + the full bundle.
    expect(screen.getAllByText('Netflix').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Max')).toBeInTheDocument();
    expect(screen.getByText(/täcker 2 av 3/)).toBeInTheDocument();
    expect(screen.getByText('169 kr/mån')).toBeInTheDocument();
    // Cheapest full bundle + the consolidation saving.
    expect(screen.getByText('318 kr/mån')).toBeInTheDocument();
    expect(screen.getByText(/Spara 82 kr\/mån/)).toBeInTheDocument();
    // Rent counted, never priced.
    expect(screen.getByText(/1 titel går att hyra\/köpa/)).toBeInTheDocument();
    // JustWatch attribution present (required on any surface showing provider data).
    expect(screen.getByText(/JustWatch/)).toBeInTheDocument();
  });

  it('shows a 0-kr "already owned" label instead of a fabricated cost', () => {
    mockUseListCheapestPlan.mockReturnValue(
      result({ plan: { ...basePlan, bestSingle: { ...basePlan.bestSingle, monthlyKr: 0 } } }),
    );
    render(<ListCheapestPlanPanel items={items} />);
    expect(screen.getByText(/ingår i en tjänst du har/)).toBeInTheDocument();
  });

  it('hides the bundle row when a single service covers everything streamable', () => {
    mockUseListCheapestPlan.mockReturnValue(
      result({
        plan: { ...basePlan, fullPlan: { ...basePlan.fullPlan, serviceIds: [8] }, savingKr: 0 },
      }),
    );
    render(<ListCheapestPlanPanel items={items} />);
    expect(screen.queryByText(/Spara/)).not.toBeInTheDocument();
    expect(screen.queryByText('Hela listan')).not.toBeInTheDocument();
  });

  it('states plainly when nothing streams in Sweden (no fabricated coverage)', () => {
    mockUseListCheapestPlan.mockReturnValue(
      result({
        plan: {
          ...basePlan,
          streamableCount: 0,
          bestSingle: { providerId: null, providerName: null, monthlyKr: null, coveredCount: 0, remainder: [], rentCount: 0, unavailableCount: 3 },
          fullPlan: { serviceIds: [], monthlyKr: 0, streamableCovered: 0, rentCount: 2, unavailableCount: 1 },
          naiveMonthlyKr: 0,
          savingKr: 0,
        },
      }),
    );
    render(<ListCheapestPlanPanel items={items} />);
    expect(screen.getByText(/Inga av titlarna finns på en streamingtjänst/)).toBeInTheDocument();
    expect(screen.getByText(/1 saknas i Sverige/)).toBeInTheDocument();
  });

  it('discloses uncheckable titles separately from unavailable', () => {
    mockUseListCheapestPlan.mockReturnValue(result({ plan: basePlan, uncheckableCount: 2 }));
    render(<ListCheapestPlanPanel items={items} />);
    expect(screen.getByText(/2 titlar kunde inte kontrolleras just nu/)).toBeInTheDocument();
  });

  it('shows a loading line while the fan-out settles', () => {
    mockUseListCheapestPlan.mockReturnValue(result({ isLoading: true }));
    render(<ListCheapestPlanPanel items={items} />);
    expect(screen.getByText(/Räknar ut billigaste vägen/)).toBeInTheDocument();
  });
});
