import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AdvisorResult, BundleSuggestion } from '@/types';

// BIN-442 consumer regression: the bundle-arbitrage panel is engineered to
// survive a TMDB outage — its data (bundleSuggestions) is built from owned
// services + costs only, with no TMDB fan-out. But the Streamingrådgivaren page
// used to early-return the "Inga tjänster tillagda än" empty-state whenever
// `providers.length === 0`, which ALSO happens during a cold-cache TMDB outage
// (providers is derived from the fan-out and zeroes out on a total fetch error).
// That hid the one panel meant to stay up. These tests pin that the page now
// renders the card whenever there are suggestions, independent of the guard.
//
// The card itself is exercised in BundleArbitrageCard.test.tsx; here we only
// assert the PAGE's render decision, so we mock everything around it.

// A sibling panel transitively imports the Firebase config module, whose
// top-level getAuth() throws on the dummy test-env API key. Stub it — nothing
// on the tested (providers-empty) render path touches Firebase.
vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

// AuthGuard gatekeeps on real Firebase Auth — bypass so the page body renders.
vi.mock('@/components/AuthGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The page reads pause/resume + profileLoading from useAuth; none matter here.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ pauseProvider: vi.fn(), resumeProvider: vi.fn(), profileLoading: false }),
}));

const advisorMock = vi.fn<() => AdvisorResult>();
vi.mock('@/hooks/useSubscriptionAdvisor', () => ({
  useSubscriptionAdvisor: () => advisorMock(),
}));

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

import SavingsPage from './page';

function baseAdvisor(over: Partial<AdvisorResult> = {}): AdvisorResult {
  return {
    providers: [],
    subscribeAdvice: [],
    willSeeByProvider: [],
    monthlySavings: 0,
    totalMonthlyCost: 0,
    isLoading: false,
    hasError: false,
    primaryAction: { kind: 'idle', nextCheckDate: null },
    secondaryAction: null,
    activePauses: [],
    mostUsedProvider: null,
    unfinishedTmdbIds: new Set<number>(),
    endedCaughtUpTmdbIds: new Set<number>(),
    bundleSuggestions: [],
    ...over,
  };
}

const SUGGESTION: BundleSuggestion = {
  bundle: {
    id: 'telia-mer',
    name: 'Telia Streaming Mer',
    vendor: 'Telia',
    monthlyKr: 269,
    includedProviderIds: [8, 384, 337],
    verifiedDate: '2026-07-07',
    url: 'https://www.telia.se/tv/streaming/streaming-mer',
  },
  replacedProviderIds: [8, 384],
  replacedNames: ['Netflix', 'Max'],
  currentKr: 327,
  bundleKr: 269,
  savingKr: 58,
  bonusProviderIds: [337],
  bonusNames: ['Disney+'],
  downgradeProviderIds: [],
  downgradeNames: [],
  stale: false,
};

describe('SavingsPage — bundle card survives a TMDB outage (BIN-442)', () => {
  beforeEach(() => {
    advisorMock.mockReset();
  });

  it('renders the bundle-arbitrage card when providers is empty but suggestions exist', () => {
    // TMDB outage: hasError + no providers, yet the (TMDB-free) engine still
    // has a bundle suggestion.
    advisorMock.mockReturnValue(
      baseAdvisor({ providers: [], hasError: true, bundleSuggestions: [SUGGESTION] }),
    );
    render(<SavingsPage />);

    // The real BundleArbitrageCard is shown…
    expect(
      screen.getByText('Dina lösa tjänster kan bli billigare i ett paket'),
    ).toBeInTheDocument();
    expect(screen.getByText('spara 58 kr/mån')).toBeInTheDocument();
    // …and the misleading "no services" empty-state is NOT.
    expect(screen.queryByText('Inga tjänster tillagda än')).not.toBeInTheDocument();
  });

  it('shows the "no services" empty-state when there are neither providers nor suggestions', () => {
    advisorMock.mockReturnValue(baseAdvisor({ providers: [], bundleSuggestions: [] }));
    render(<SavingsPage />);

    expect(screen.getByText('Inga tjänster tillagda än')).toBeInTheDocument();
    expect(
      screen.queryByText('Dina lösa tjänster kan bli billigare i ett paket'),
    ).not.toBeInTheDocument();
  });
});
