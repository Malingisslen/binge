import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { GUEST_PROVIDERS_KEY } from '@/lib/guestProviders';

const auth = vi.hoisted(() => ({ uid: null as string | null }));
// ONE router object — a per-call factory would make the push assertions vacuous.
const push = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => {
  const router = { push };
  return { useRouter: () => router };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/analytics', () => ({ trackEvent: track }));

import CostCalculator from './CostCalculator';

const NEXT_KEY = 'binge:nextAfterLogin';
const bar = () => screen.getByTestId('cost-bar');
// next/link drops the trailing slash in the test env (no trailingSlash config here).
const row = (name: string) => screen.getByRole('checkbox', { name }).closest('li')!;

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/streamingkostnad/');
  auth.uid = null;
});

describe('CostCalculator', () => {
  it('starts empty and asks for a choice; the save button is disabled', async () => {
    await act(async () => { render(<CostCalculator />); });
    expect(bar()).toHaveTextContent('Kryssa i en tjänst för att se summan.');
    expect(screen.getByRole('button', { name: 'Logga in och spara' })).toBeDisabled();
  });

  it('"Vet inte" gives the list price marked uppskattat; picking a tier removes the mark (#28 condition 7)', async () => {
    await act(async () => { render(<CostCalculator />); });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    expect(bar()).toHaveTextContent(/Per månad\s*169 kr/);
    expect(bar()).toHaveTextContent(/Per år, uppskattat\s*2 028 kr/);
    expect(within(row('Netflix')).getByText('uppskattat')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Nivå för Netflix' }), { target: { value: 'basic' } });
    expect(bar()).toHaveTextContent(/Per månad\s*129 kr/);
    expect(bar()).toHaveTextContent(/Per år\s*1 548 kr/);
    expect(bar()).not.toHaveTextContent('uppskattat');
    expect(within(row('Netflix')).queryByText('uppskattat')).toBeNull();
  });

  it('unchecking the last service empties the sum and clears the shared key', async () => {
    await act(async () => { render(<CostCalculator />); });
    const netflix = screen.getByRole('checkbox', { name: 'Netflix' });
    fireEvent.click(netflix);
    expect(window.sessionStorage.getItem(GUEST_PROVIDERS_KEY)).not.toBeNull();
    fireEvent.click(netflix);
    expect(netflix).not.toBeChecked();
    expect(bar()).toHaveTextContent('Kryssa i en tjänst för att se summan.');
    expect(window.sessionStorage.getItem(GUEST_PROVIDERS_KEY)).toBeNull();
  });

  it('choosing a tier on an unchecked row checks it', async () => {
    await act(async () => { render(<CostCalculator />); });
    fireEvent.change(screen.getByRole('combobox', { name: 'Nivå för Disney+' }), { target: { value: 'ads' } });
    expect(screen.getByRole('checkbox', { name: 'Disney+' })).toBeChecked();
  });

  it('labels sport tiers in the select', async () => {
    await act(async () => { render(<CostCalculator />); });
    const select = screen.getByRole('combobox', { name: 'Nivå för Viaplay' });
    // A tier whose name already says sport gets no second "(sport)".
    expect(within(select).getByRole('option', { name: 'Total (all sport)' })).toBeInTheDocument();
    expect(within(select).getAllByRole('option')[0]).toHaveTextContent('Vet inte');
  });

  it('has no row for free or ad-funded services', async () => {
    await act(async () => { render(<CostCalculator />); });
    expect(screen.queryByRole('checkbox', { name: 'SVT Play' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Pluto TV' })).toBeNull();
    expect(screen.getByText(/SVT Play.*är gratis och står inte med\./)).toBeInTheDocument();
  });

  it('shows the bundle box when the selection fits a bundle', async () => {
    await act(async () => { render(<CostCalculator />); });
    fireEvent.change(screen.getByRole('combobox', { name: 'Nivå för Netflix' }), { target: { value: 'standard' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Nivå för HBO Max' }), { target: { value: 'ads' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Nivå för Disney+' }), { target: { value: 'ads' } });
    expect(screen.getByTestId('guest-bundle')).toHaveTextContent('Billigare som paket');
  });

  it('prefills from the shared session key and writes every change back to it', async () => {
    window.sessionStorage.setItem(GUEST_PROVIDERS_KEY, JSON.stringify({ 76: 'standard' }));
    await act(async () => { render(<CostCalculator />); });
    expect(screen.getByRole('checkbox', { name: 'Viaplay' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    expect(JSON.parse(window.sessionStorage.getItem(GUEST_PROVIDERS_KEY)!)).toEqual({ 76: 'standard', 8: null });
  });

  it('"Logga in och spara" keeps the selection, remembers the page and goes through /login (#26 condition 6)', async () => {
    await act(async () => { render(<CostCalculator />); });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    fireEvent.click(screen.getByRole('button', { name: 'Logga in och spara' }));
    expect(push).toHaveBeenCalledWith('/login/');
    expect(window.sessionStorage.getItem(NEXT_KEY)).toBe('/streamingkostnad/');
    expect(JSON.parse(window.sessionStorage.getItem(GUEST_PROVIDERS_KEY)!)).toEqual({ 8: null });
    expect(track).toHaveBeenCalledWith('price_check_save_clicked', { paidCount: 1 });
  });

  it('fires the total event once per view, not once per change', async () => {
    await act(async () => { render(<CostCalculator />); });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Viaplay' }));
    const totals = track.mock.calls.filter(c => c[0] === 'price_check_total_shown');
    expect(totals).toEqual([['price_check_total_shown', { surface: 'calculator', paidCount: 1 }]]);
  });

  it('a signed-in visitor gets a link to their settings instead of the sign-in button', async () => {
    auth.uid = 'u1';
    await act(async () => { render(<CostCalculator />); });
    expect(screen.queryByRole('button', { name: 'Logga in och spara' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ändra dina tjänster' })).toHaveAttribute('href', expect.stringMatching(/^\/settings\/?$/));
  });

  it('links to the price page', async () => {
    await act(async () => { render(<CostCalculator />); });
    expect(screen.getByRole('link', { name: 'Se alla priser och prisändringar' })).toHaveAttribute('href', expect.stringMatching(/^\/streamingpriser\/?$/));
  });
});
