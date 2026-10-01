import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { krText, verbatim } from '@/test/krText';

// BIN-1374/BIN-1375: formatKr's own test proves the helper groups thousands, but
// not that this settings list calls it. A regression to a raw `{total}` would
// print "1234 kr/mån" and stay green everywhere else.

const auth = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  updateProviders: vi.fn(async () => {}),
  setProviderCost: vi.fn(async () => {}),
  setProviderRenewalDay: vi.fn(async () => {}),
  updateProviderTier: vi.fn(),
  setProviderCampaign: vi.fn(async () => {}),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

// BIN-1385: no catalog tier reaches four digits, so the tier dropdown is fed a
// Netflix entry with one tier above 1000 and one below.
vi.mock('@/lib/tmdb/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tmdb/providers')>();
  return {
    ...actual,
    SWEDISH_PROVIDERS: actual.SWEDISH_PROVIDERS.map(p =>
      p.id === 8
        ? {
            ...p,
            tiers: [
              { id: 'basic', name: 'Basic', cost: 129 },
              { id: 'premium', name: 'Premium', cost: 1099 },
            ],
          }
        : p,
    ),
  };
});

import { ProvidersSection } from './ProvidersSection';

// The section starts collapsed once the user has saved providers.
function renderExpanded() {
  render(<ProvidersSection />);
  fireEvent.click(screen.getByRole('button', { name: /mina streamingtjänster/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProvidersSection — kronbelopp grupperas i tusental (BIN-1374, BIN-1375, BIN-1385)', () => {
  it('skriver en fyrsiffrig månadssumma med tusentalsavgränsare', () => {
    auth.user = { myProviders: [8], providerCosts: { 8: 1234 } };
    renderExpanded();

    expect(screen.getByText(krText('1 234 kr/mån'), verbatim)).toBeInTheDocument();
  });

  it('skriver ett fyrsiffrigt kampanjpris med tusentalsavgränsare', () => {
    auth.user = {
      myProviders: [8],
      providerCosts: { 8: 1234 },
      providerCampaigns: { 8: { monthlyCost: 1099, endDate: '2099-12-31' } },
    };
    renderExpanded();

    expect(screen.getByText(krText('1 099 kr'), verbatim)).toBeInTheDocument();
  });

  it('skriver ett fyrsiffrigt nivåpris i nivåvalet med tusentalsavgränsare', () => {
    auth.user = { myProviders: [8], providerCosts: { 8: 1234 } };
    renderExpanded();

    expect(screen.getByRole('option', { name: krText('Premium — 1 099 kr') })).toBeInTheDocument();
  });

  it('skriver ett nivåpris under 1000 utan avgränsare', () => {
    auth.user = { myProviders: [8], providerCosts: { 8: 1234 } };
    renderExpanded();

    expect(screen.getByRole('option', { name: krText('Basic — 129 kr') })).toBeInTheDocument();
  });
});
