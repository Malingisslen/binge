import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, getDefaultNormalizer } from '@testing-library/react';
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

// BIN-1366: the full (providers-present) render path mounts sibling panels that
// read their own hooks, so they render nothing here; the existing
// providers-empty tests never reach them.
vi.mock('@/components/savings/CampaignExpiryNudges', () => ({ default: () => null }));
vi.mock('@/components/savings/ProvidersByValue', () => ({ default: () => null }));
vi.mock('@/components/savings/ServiceValueCard', () => ({ default: () => null }));
vi.mock('@/components/savings/RotationCalendar', () => ({ default: () => null }));
vi.mock('@/components/savings/SavingsSidebar', () => ({ default: () => null }));
vi.mock('@/components/savings/UpcomingEpisodes', () => ({ default: () => null }));

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
    hasConfiguredProviders: false,
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
  bindingMonths: 0,
  startFeeKr: 0,
  startFeeMonthlyKr: 0,
  commitmentTotalKr: null,
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

  // BIN-448: a TMDB outage zeroes `providers` even for a user who DOES have
  // services. With no bundle suggestions to fall back on, the page must not claim
  // "Inga tjänster tillagda än" — it must show an honest outage state instead.
  it('shows an outage state (not the "no services" empty-state) when hasError and nothing to fall back on', () => {
    advisorMock.mockReturnValue(
      baseAdvisor({ providers: [], hasError: true, hasConfiguredProviders: true, bundleSuggestions: [] }),
    );
    render(<SavingsPage />);

    expect(
      screen.getByText('Kunde inte räkna på dina tjänster just nu'),
    ).toBeInTheDocument();
    expect(screen.getByText('Försök igen')).toBeInTheDocument();
    expect(screen.queryByText('Inga tjänster tillagda än')).not.toBeInTheDocument();
  });

  // BIN-448 disambiguation: a user who has NOT added any service but tracks shows
  // can get hasError:true by coincidence (a followed-show TMDB fetch happened to
  // fail), unrelated to any real outage. The outage state is gated on
  // hasConfiguredProviders, so this user must see the actionable "add services"
  // state — not the misleading "couldn't reach streaming data" outage message.
  it('shows the "no services" state (not the outage state) when hasError but no services configured', () => {
    advisorMock.mockReturnValue(
      baseAdvisor({ providers: [], hasError: true, hasConfiguredProviders: false, bundleSuggestions: [] }),
    );
    render(<SavingsPage />);

    expect(screen.getByText('Inga tjänster tillagda än')).toBeInTheDocument();
    expect(
      screen.queryByText('Kunde inte räkna på dina tjänster just nu'),
    ).not.toBeInTheDocument();
  });
});

// BIN-1366: formatKr's own test proves the helper groups thousands, but not that
// the page calls it. The paused-services section is the page's own kr call site:
// a regression to a raw `{totalSaved}` would print "1234" and stay green there.
describe('SavingsPage — paused-service amounts are grouped by thousands (BIN-1366)', () => {
  const NBSP = ' ';
  // The default normalizer collapses every \s run, NBSP included, to a plain
  // space; keep whitespace verbatim so the assertion sees the separator itself.
  const exact = { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) };

  beforeEach(() => {
    advisorMock.mockReset();
  });

  it('writes a four-digit saved-so-far total and row amount with a thousands separator', () => {
    advisorMock.mockReturnValue(
      baseAdvisor({
        providers: [
          { providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: '#e50914', shows: [], monthlyCost: 149, status: 'active', nextAirDate: null },
        ],
        hasConfiguredProviders: true,
        activePauses: [
          { providerId: 384, providerName: 'Max', shortName: 'Max', color: '#002be7', pausedAt: '2025-01-01', resumeAt: null, monthlyCost: 129, savingsSoFar: 1000 },
          { providerId: 337, providerName: 'Disney+', shortName: 'Disney+', color: '#113ccf', pausedAt: '2025-06-01', resumeAt: null, monthlyCost: 119, savingsSoFar: 234 },
        ],
      }),
    );
    render(<SavingsPage />);

    expect(screen.getByText(`Sparat hittills: 1${NBSP}234 kr`, exact)).toBeInTheDocument();
    expect(screen.getByText(`+1${NBSP}000 kr`, exact)).toBeInTheDocument();
  });
});
