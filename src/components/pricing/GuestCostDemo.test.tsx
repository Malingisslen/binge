import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GUEST_PROVIDERS_KEY } from '@/lib/guestProviders';

const track = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', () => ({ trackEvent: track }));

import GuestCostDemo from './GuestCostDemo';

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe('GuestCostDemo', () => {
  it('shows no sum until a service is tapped', async () => {
    await act(async () => { render(<GuestCostDemo />); });
    expect(screen.queryByText(/kr\/mån/)).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });

  it('tapping a service shows the list price marked uppskattat and fires the home event', async () => {
    await act(async () => { render(<GuestCostDemo />); });
    fireEvent.click(screen.getByRole('button', { name: 'Netflix' }));
    expect(screen.getByRole('button', { name: 'Netflix' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/kr\/mån/).closest('p')).toHaveTextContent('169 kr/mån uppskattat · 2 028 kr/år');
    expect(track).toHaveBeenCalledWith('price_check_total_shown', { surface: 'home', paidCount: 1 });
  });

  it('tapping the same service again unselects it, hides the sum and clears the shared key', async () => {
    await act(async () => { render(<GuestCostDemo />); });
    const netflix = screen.getByRole('button', { name: 'Netflix' });
    fireEvent.click(netflix);
    expect(window.sessionStorage.getItem(GUEST_PROVIDERS_KEY)).not.toBeNull();
    fireEvent.click(netflix);
    expect(netflix).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/kr\/mån/)).toBeNull();
    expect(window.sessionStorage.getItem(GUEST_PROVIDERS_KEY)).toBeNull();
  });

  it('a bundle-fitting selection from the calculator shows the compact bundle box', async () => {
    window.sessionStorage.setItem(GUEST_PROVIDERS_KEY, JSON.stringify({ 8: 'standard', 384: 'ads', 337: 'ads' }));
    await act(async () => { render(<GuestCostDemo />); });
    const box = screen.getByTestId('guest-bundle');
    expect(box).toHaveTextContent('Billigare som paket');
    expect(box).not.toHaveTextContent('Totalt under bindningstiden');
    expect(screen.queryByRole('link', { name: /^Till / })).toBeNull();
  });
});
