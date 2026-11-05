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
  setProviderBinding: vi.fn(async () => {}),
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

describe('ProvidersSection — bindningstid', () => {
  it('erbjuder att lägga till en bindning när ingen finns', () => {
    auth.user = { myProviders: [8], providerCosts: { 8: 169 } };
    renderExpanded();
    expect(screen.getByRole('button', { name: '+ Lägg till bindningstid' })).toBeInTheDocument();
  });

  it('visar slutmånaden försiktigt, utan "sista dag" eller löfte om uppsägning', () => {
    const start = new Date();
    const startedOn = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
    auth.user = { myProviders: [8], providerBindings: { 8: { months: 12, startedOn, monthlyCost: 99 } } };
    renderExpanded();
    const row = screen.getByText(/Bindningstid:/);
    expect(row.textContent).toMatch(/bunden till och med .* \d{4}/);
    expect(row.textContent).toContain('enligt dina uppgifter. Kolla ditt avtal.');
    expect(row.textContent).not.toMatch(/sista dag|kan säga upp/i);
    expect(screen.getByRole('button', { name: 'Ta bort bindning' })).toBeInTheDocument();
  });

  it('en utgången bindning visas i dåtid och aldrig som "Bunden till"', () => {
    auth.user = { myProviders: [8], providerBindings: { 8: { months: 3, startedOn: '2024-01', monthlyCost: 99 } } };
    renderExpanded();
    expect(screen.getByText(/Bindningen gick ut apr 2024/)).toBeInTheDocument();
    expect(screen.queryByText(/bunden till/i)).toBeNull();
  });

  it('sparar längd, startmånad och pris för hand; Spara är låst tills priset är ifyllt', () => {
    auth.user = { myProviders: [8] };
    renderExpanded();
    fireEvent.click(screen.getByRole('button', { name: '+ Lägg till bindningstid' }));
    const save = screen.getByRole('button', { name: 'Spara' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Bindningens längd'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Månaden bindningen började'), { target: { value: '2026-11' } });
    fireEvent.change(screen.getByLabelText('Pris per månad under bindningen'), { target: { value: '79' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(auth.setProviderBinding).toHaveBeenCalledWith(8, { months: 6, startedOn: '2026-11', monthlyCost: 79 });
  });

  it('Ta bort bindning rensar posten', () => {
    const now = new Date();
    const startedOn = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    auth.user = { myProviders: [8], providerBindings: { 8: { months: 12, startedOn, monthlyCost: 99 } } };
    renderExpanded();
    fireEvent.click(screen.getByRole('button', { name: 'Ta bort bindning' }));
    expect(auth.setProviderBinding).toHaveBeenCalledWith(8, null);
  });
});
