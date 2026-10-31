import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
const pauseProviderMock = vi.fn(() => Promise.resolve());
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ pauseProvider: pauseProviderMock, resumeProvider: vi.fn(), profileLoading: false, uid: 'u1' }),
}));

const pauseHistoryMock = vi.fn(() => ({ history: [], totalSaved: 0, isLoading: false }));
vi.mock('@/hooks/usePauseHistory', () => ({ usePauseHistory: () => pauseHistoryMock() }));

const advisorMock = vi.fn<() => AdvisorResult>();
vi.mock('@/hooks/useSubscriptionAdvisor', () => ({
  useSubscriptionAdvisor: () => advisorMock(),
}));

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

// Steg 2b: the Jag/Hushållet switch reads the user's groups; the household view reads its
// own hooks. Both are stubbed so the page test decides only the page's render decisions.
const groupsMock = vi.hoisted(() => ({ groups: [] as { id: string; name: string }[] }));
vi.mock('@/hooks/useGroups', () => ({ useMyGroups: () => ({ groups: groupsMock.groups, loading: false }) }));
vi.mock('@/hooks/useGroupHousehold', () => ({
  useGroupHousehold: () => ({
    status: 'gated', contributions: [], optIn: vi.fn(), optOut: vi.fn(), busy: false, ready: true,
    needsReshare: false, myVotes: {}, soon: null, setVote: vi.fn(),
  }),
}));
vi.mock('@/hooks/useGroupMemberNames', () => ({ useGroupMemberNames: () => ({}) }));

// BIN-1366: the full (providers-present) render path mounts sibling panels that
// read their own hooks, so they render nothing here; the existing
// providers-empty tests never reach them.
vi.mock('@/components/savings/CampaignExpiryNudges', () => ({ default: () => null }));
vi.mock('@/components/savings/PriceChangeNudges', () => ({ default: () => <div data-testid="price-change-nudges" /> }));
vi.mock('@/components/savings/ProvidersByValue', () => ({ default: () => null }));
const monthlyBillMock = vi.fn<() => MonthlyBill | null>(() => null);
vi.mock('@/hooks/useMonthlyBill', () => ({ useMonthlyBill: () => monthlyBillMock() }));
vi.mock('@/components/savings/RotationCalendar', () => ({ default: () => null }));
vi.mock('@/components/savings/SavingsSidebar', () => ({ default: () => null }));
vi.mock('@/components/savings/UpcomingEpisodes', () => ({ default: () => null }));

import SavingsPage from './page';
import type { MonthlyBill } from '@/lib/advisor/monthlyBill';
import { krText, verbatim } from '@/test/krText';

function baseAdvisor(over: Partial<AdvisorResult> = {}): AdvisorResult {
  return {
    providers: [],
    subscribeAdvice: [],
    willSeeByProvider: [],
    monthlySavings: 0,
    totalMonthlyCost: 0,
    totalMonthlyCostEstimated: false,
    isLoading: false,
    hasError: false,
    hasConfiguredProviders: false,
    primaryAction: { kind: 'idle', nextCheckDate: null },
    secondaryAction: null,
    pauseAdviceReady: true,
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

    expect(screen.getByText(krText('Sparat hittills: 1 234 kr'), verbatim)).toBeInTheDocument();
    expect(screen.getByText(krText('+1 000 kr'), verbatim)).toBeInTheDocument();
  });
});

// Paket K: under pausgolvet visar sidan inget som räknar på pauser — inga steg
// med Pausa-knapp och ingen rotationsplan — men kostnaden och paketen står kvar.
describe('SavingsPage — pausgolvet', () => {
  beforeEach(() => {
    advisorMock.mockReset();
  });

  it('visar ingen pausknapp och ber om fler titlar när biblioteket är för litet', () => {
    advisorMock.mockReturnValue(
      baseAdvisor({
        providers: [
          { providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: '#e50914', shows: [], monthlyCost: 169, status: 'pause', nextAirDate: null },
        ],
        hasConfiguredProviders: true,
        totalMonthlyCost: 169,
        pauseAdviceReady: false,
        primaryAction: { kind: 'needs-library', titleCount: 0, minTitles: 3 },
        bundleSuggestions: [SUGGESTION],
      }),
    );
    render(<SavingsPage />);

    expect(screen.getByText(/Lägg till det du följer, så kan Binge räkna/)).toBeInTheDocument();
    expect(screen.queryByText('Pausa →')).not.toBeInTheDocument();
    expect(screen.queryByText(/Netflix kan pausas/)).not.toBeInTheDocument();
    expect(screen.getByText('Utforska serier')).toBeInTheDocument();
    expect(screen.getByText('Dina lösa tjänster kan bli billigare i ett paket')).toBeInTheDocument();
    // Prisändringar beror inte på biblioteket, så de står kvar under golvet.
    expect(screen.getByTestId('price-change-nudges')).toBeInTheDocument();
  });

  it('visar pausförslaget när biblioteket räcker', () => {
    advisorMock.mockReturnValue(
      baseAdvisor({
        providers: [
          { providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: '#e50914', shows: [], monthlyCost: 169, status: 'pause', nextAirDate: null },
        ],
        hasConfiguredProviders: true,
        totalMonthlyCost: 169,
        primaryAction: { kind: 'pause', providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: '#e50914', monthlyCost: 169, nextAirDate: null },
      }),
    );
    render(<SavingsPage />);

    expect(screen.getByText('Pausa →')).toBeInTheDocument();
    expect(screen.queryByText(/Lägg till det du följer/)).not.toBeInTheDocument();
    expect(screen.getByTestId('price-change-nudges')).toBeInTheDocument();
  });
});

// BIN-1449: the monthly bill takes the place "Behåll eller säg upp?" had.
describe('SavingsPage — månadsnotan', () => {
  const PROVIDERS = [
    { providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: '#e50914', shows: [], monthlyCost: 169, status: 'active' as const, nextAirDate: null },
  ];
  beforeEach(() => {
    advisorMock.mockReset();
    monthlyBillMock.mockReset();
  });

  it('shows last month’s bill when the hook has one', () => {
    advisorMock.mockReturnValue(baseAdvisor({ providers: PROVIDERS, hasConfiguredProviders: true }));
    monthlyBillMock.mockReturnValue({
      month: { startMs: 0, endMs: 1, name: 'september', firstDay: '2026-09-01', lastDay: '2026-09-30' },
      lines: [{ providerId: 8, costKr: 169, pausedWholeMonth: false, episodes: 4, films: 0, krPerItem: 42 }],
      totalKr: 169, episodes: 4, films: 0, krPerItem: 42,
    });
    render(<SavingsPage />);
    expect(screen.getByRole('heading', { name: 'Din streaming i september' })).toBeInTheDocument();
    expect(screen.getByText('4 avsnitt · 42 kr per avsnitt')).toBeInTheDocument();
  });

  it('shows no bill when there is nothing to bill', () => {
    advisorMock.mockReturnValue(baseAdvisor({ providers: PROVIDERS, hasConfiguredProviders: true }));
    monthlyBillMock.mockReturnValue(null);
    render(<SavingsPage />);
    expect(screen.queryByTestId('monthly-bill')).toBeNull();
    expect(screen.queryByText('Behåll eller säg upp?')).toBeNull();
  });
});

// Steg 1: ett svar överst, en dom per tjänst och flikar som minns valet i URL:en.
describe('SavingsPage — svar, domar och flikar', () => {
  const NETFLIX = { providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: '#e50914', shows: [], monthlyCost: 169, status: 'pause' as const, nextAirDate: '2099-01-15' };
  const HBO = { providerId: 384, providerName: 'Max', shortName: 'Max', color: '#002be7', shows: [], monthlyCost: 129, status: 'active' as const, nextAirDate: null };
  const pauseAction = { kind: 'pause' as const, providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: '#e50914', monthlyCost: 169, nextAirDate: '2099-01-15' };

  beforeEach(() => {
    advisorMock.mockReset();
    monthlyBillMock.mockReset();
    monthlyBillMock.mockReturnValue(null);
    pauseProviderMock.mockClear();
    pauseHistoryMock.mockReset();
    pauseHistoryMock.mockReturnValue({ history: [], totalSaved: 0, isLoading: false });
    window.history.replaceState(null, '', '/savings/');
  });

  it('answers once at the top with the amount and a pause button that pauses until the resume date', () => {
    advisorMock.mockReturnValue(baseAdvisor({
      providers: [NETFLIX, HBO], hasConfiguredProviders: true, primaryAction: pauseAction,
    }));
    render(<SavingsPage />);

    expect(screen.getByRole('heading', { name: 'Den här månaden' })).toBeInTheDocument();
    expect(screen.getByText(krText('Pausa Netflix och spara 169 kr/mån.'), verbatim)).toBeInTheDocument();
    const hero = screen.getByRole('region', { name: 'Den här månaden' });
    fireEvent.click(within(hero).getByRole('button', { name: /^Pausa till/ }));
    expect(pauseProviderMock).toHaveBeenCalledWith(8, '2099-01-15');
  });

  it('explains the answer under "Varför?"', () => {
    advisorMock.mockReturnValue(baseAdvisor({
      providers: [NETFLIX], hasConfiguredProviders: true, primaryAction: pauseAction,
    }));
    render(<SavingsPage />);
    expect(screen.getByText(/Inget från din Följer eller Vill se ligger på Netflix före/)).toBeInTheDocument();
    expect(screen.getByText(/Varför\?/)).toBeInTheDocument();
  });

  it('offers the bundle as the answer when there is nothing to pause', () => {
    advisorMock.mockReturnValue(baseAdvisor({
      providers: [HBO], hasConfiguredProviders: true, bundleSuggestions: [SUGGESTION],
    }));
    render(<SavingsPage />);
    expect(screen.getByText(/Samla Netflix och Max i Telia Streaming Mer och spara 58 kr\/mån/)).toBeInTheDocument();
  });

  it('shows the bundle’s bindning and startavgift next to the hero’s saving claim', () => {
    advisorMock.mockReturnValue(baseAdvisor({
      providers: [HBO], hasConfiguredProviders: true,
      bundleSuggestions: [{ ...SUGGESTION, bindingMonths: 12, startFeeKr: 120, startFeeMonthlyKr: 10 }],
    }));
    render(<SavingsPage />);
    const hero = screen.getByRole('region', { name: 'Den här månaden' });
    expect(within(hero).getByText(/12 mån bindningstid · startavgift 120 kr/)).toBeInTheDocument();
  });

  it('gives each service a verdict card', () => {
    advisorMock.mockReturnValue(baseAdvisor({
      providers: [NETFLIX, HBO], hasConfiguredProviders: true, primaryAction: pauseAction,
    }));
    render(<SavingsPage />);
    const cards = within(screen.getByRole('tabpanel', { name: 'Tjänster' })).getAllByRole('listitem');
    expect(within(cards[0]).getByText('Pausa')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Behåll')).toBeInTheDocument();
  });

  it('shows the saved-so-far total high up from the pause history', () => {
    pauseHistoryMock.mockReturnValue({ history: [], totalSaved: 2094, isLoading: false });
    advisorMock.mockReturnValue(baseAdvisor({ providers: [HBO], hasConfiguredProviders: true }));
    render(<SavingsPage />);
    expect(screen.getByRole('heading', { name: 'Sparat hittills' })).toBeInTheDocument();
    expect(screen.getByText(krText('2 094 kr'), verbatim)).toBeInTheDocument();
  });

  it('opens on Tjänster and shows only that panel', () => {
    advisorMock.mockReturnValue(baseAdvisor({
      providers: [HBO], hasConfiguredProviders: true, bundleSuggestions: [SUGGESTION],
    }));
    render(<SavingsPage />);
    expect(screen.getByRole('tab', { name: 'Tjänster' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Tjänster' })).toBeVisible();
    expect(screen.queryByRole('tabpanel', { name: 'Paket' })).toBeNull();
  });

  it('opens the tab named in the URL hash', () => {
    window.history.replaceState(null, '', '/savings/#paket');
    advisorMock.mockReturnValue(baseAdvisor({
      providers: [HBO], hasConfiguredProviders: true, bundleSuggestions: [SUGGESTION],
    }));
    render(<SavingsPage />);
    expect(screen.getByRole('tab', { name: 'Paket' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Paket' })).toBeVisible();
  });

  it('writes the chosen tab to the hash', () => {
    advisorMock.mockReturnValue(baseAdvisor({ providers: [HBO], hasConfiguredProviders: true }));
    render(<SavingsPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Pausa & rotera' }));
    expect(window.location.hash).toBe('#pausa');
    expect(screen.getByRole('tabpanel', { name: 'Pausa & rotera' })).toBeVisible();
  });

  it('the hero’s bundle button switches to the Paket tab', () => {
    advisorMock.mockReturnValue(baseAdvisor({
      providers: [HBO], hasConfiguredProviders: true, bundleSuggestions: [SUGGESTION],
    }));
    render(<SavingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Visa paketet' }));
    expect(window.location.hash).toBe('#paket');
    expect(screen.getByRole('tabpanel', { name: 'Paket' })).toBeVisible();
  });

  it('the hero’s subscribe button opens and scrolls to the titles on Detaljer, like the numbered step', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    advisorMock.mockReturnValue(baseAdvisor({
      providers: [HBO], hasConfiguredProviders: true,
      primaryAction: { kind: 'subscribe', providerId: 337, providerName: 'Disney+', shortName: 'Disney+', color: '#113ccf', showCount: 1, nearestAirDate: '2099-02-01', monthlyCost: 119 },
      subscribeAdvice: [{
        providerId: 337, providerName: 'Disney+', shortName: 'Disney+', color: '#113ccf', nearestAirDate: '2099-02-01',
        shows: [{ tmdbId: 1, mediaType: 'tv', title: 'Serie X', posterPath: null, nextAirDate: '2099-02-01', nextEpisodeCode: null, isEnded: false, releaseDate: null, providerIds: [337] }],
      }],
    }));
    render(<SavingsPage />);
    const hero = screen.getByRole('region', { name: 'Den här månaden' });
    fireEvent.click(within(hero).getByRole('button', { name: 'Visa titlar' }));
    expect(window.location.hash).toBe('#detaljer');
    expect(screen.getByRole('tabpanel', { name: 'Detaljer' })).toBeVisible();
    expect(scroll).toHaveBeenCalled();
    expect(screen.getByText('Titlar på tjänster du inte har').closest('details')).toHaveAttribute('open');
  });

  it('holds the saved-so-far figure’s place with a skeleton while the history loads', () => {
    pauseHistoryMock.mockReturnValue({ history: [], totalSaved: 0, isLoading: true });
    advisorMock.mockReturnValue(baseAdvisor({ providers: [HBO], hasConfiguredProviders: true }));
    const { container } = render(<SavingsPage />);
    expect(screen.getByRole('heading', { name: 'Sparat hittills' })).toBeInTheDocument();
    expect(container.querySelector('[data-skeleton]')).not.toBeNull();
    expect(screen.queryByText('Inget än. Din första paus räknas här.')).toBeNull();
  });

  it('moves between tabs with Home and End and makes the panels focusable', () => {
    advisorMock.mockReturnValue(baseAdvisor({ providers: [HBO], hasConfiguredProviders: true }));
    render(<SavingsPage />);
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Detaljer' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Tjänster' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Tjänster' })).toHaveAttribute('tabindex', '0');
  });

  it('under the pause floor shows no answer, no verdict cards and no tabs', () => {
    advisorMock.mockReturnValue(baseAdvisor({
      providers: [NETFLIX], hasConfiguredProviders: true, pauseAdviceReady: false,
      primaryAction: { kind: 'needs-library', titleCount: 0, minTitles: 3 },
    }));
    render(<SavingsPage />);
    expect(screen.queryByRole('heading', { name: 'Den här månaden' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Den här månaden' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Pausa till/ })).toBeNull();
  });
});

// Steg 2b: Jag/Hushållet-växeln. Den finns bara för den som är med i en grupp, och
// hushållsläget har en egen hash som inte rör flik-hasharna.
describe('SavingsPage — Jag/Hushållet-växeln', () => {
  const HBO = { providerId: 384, providerName: 'Max', shortName: 'Max', color: '#002be7', shows: [], monthlyCost: 129, status: 'active' as const, nextAirDate: null };

  beforeEach(() => {
    advisorMock.mockReset();
    advisorMock.mockReturnValue(baseAdvisor({ providers: [HBO], hasConfiguredProviders: true }));
    monthlyBillMock.mockReset();
    monthlyBillMock.mockReturnValue(null);
    pauseHistoryMock.mockReset();
    pauseHistoryMock.mockReturnValue({ history: [], totalSaved: 0, isLoading: false });
    groupsMock.groups = [];
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/savings/');
  });

  it('shows no switch for someone who is in no group', () => {
    render(<SavingsPage />);
    expect(screen.queryByRole('group', { name: 'Visa för' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hushållet' })).toBeNull();
  });

  it('shows the switch for a group member, in Jag mode with the tabs', () => {
    groupsMock.groups = [{ id: 'g1', name: 'Hemmet' }];
    render(<SavingsPage />);
    expect(screen.getByRole('button', { name: 'Jag' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Hushållet' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('switches to the household, writes #hushallet and swaps the tabs for the household view', () => {
    groupsMock.groups = [{ id: 'g1', name: 'Hemmet' }];
    render(<SavingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Hushållet' }));
    expect(window.location.hash).toBe('#hushallet');
    expect(screen.getByRole('heading', { name: 'Se vad hushållet sparar' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('goes back to Jag on the tab that was open, so the tab hash stays intact', () => {
    groupsMock.groups = [{ id: 'g1', name: 'Hemmet' }];
    window.history.replaceState(null, '', '/savings/#paket');
    render(<SavingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Hushållet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Jag' }));
    expect(window.location.hash).toBe('#paket');
    expect(screen.getByRole('tab', { name: 'Paket' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens in household mode from the hash, and ignores the hash without a group', () => {
    window.history.replaceState(null, '', '/savings/#hushallet');
    groupsMock.groups = [{ id: 'g1', name: 'Hemmet' }];
    const { unmount } = render(<SavingsPage />);
    expect(screen.getByRole('heading', { name: 'Se vad hushållet sparar' })).toBeInTheDocument();
    unmount();

    groupsMock.groups = [];
    render(<SavingsPage />);
    expect(screen.queryByRole('heading', { name: 'Se vad hushållet sparar' })).toBeNull();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('remembers the mode for the session when the hash is gone', () => {
    groupsMock.groups = [{ id: 'g1', name: 'Hemmet' }];
    const { unmount } = render(<SavingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Hushållet' }));
    unmount();
    window.history.replaceState(null, '', '/savings/');
    render(<SavingsPage />);
    expect(screen.getByRole('heading', { name: 'Se vad hushållet sparar' })).toBeInTheDocument();
  });

  it('offers a group picker only with several groups', () => {
    groupsMock.groups = [{ id: 'g1', name: 'Hemmet' }];
    const { unmount } = render(<SavingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Hushållet' }));
    expect(screen.queryByRole('combobox', { name: 'Grupp' })).toBeNull();
    unmount();

    window.sessionStorage.clear();
    groupsMock.groups = [{ id: 'g1', name: 'Hemmet' }, { id: 'g2', name: 'Kollektivet' }];
    render(<SavingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Hushållet' }));
    const picker = screen.getByRole('combobox', { name: 'Grupp' });
    expect(within(picker).getByRole('option', { name: 'Kollektivet' })).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'g2' } });
    expect(picker).toHaveValue('g2');
  });
});
