// BIN-559. Remsan för en inloggad session vars profil inte gick att läsa offline.
// Kopplingen till felet och omförsöket prövas i AuthContext.test.tsx; här prövas det
// användaren ser: texten, att knappen är avstängd medan ett försök pågår, och att
// ingenting visas utan felet.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  uid: 'u1' as string | null,
  profileLoadError: 'offline' as 'offline' | null,
  retryProfileLoad: vi.fn(async () => {}),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

import { ProfileOfflineBanner } from './ProfileOfflineBanner';

beforeEach(() => {
  auth.uid = 'u1';
  auth.profileLoadError = 'offline';
  auth.retryProfileLoad.mockReset();
  auth.retryProfileLoad.mockImplementation(async () => {});
});

describe('ProfileOfflineBanner (BIN-559)', () => {
  it('visar Malins text som en alert när profilen inte gick att läsa offline', () => {
    render(<ProfileOfflineBanner />);
    expect(screen.getByRole('alert').textContent).toContain('Ingen anslutning, försök igen.');
  });

  it('visar ingenting utan felet', () => {
    auth.profileLoadError = null;
    const { container } = render(<ProfileOfflineBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('visar ingenting för en utloggad besökare', () => {
    auth.uid = null;
    const { container } = render(<ProfileOfflineBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('knappen är avstängd och säger Försöker… medan försöket pågår, och kommer tillbaka efteråt', async () => {
    let finish: () => void = () => {};
    auth.retryProfileLoad.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
    render(<ProfileOfflineBanner />);

    await act(async () => { fireEvent.click(screen.getByText('Försök igen')); });
    const busy = screen.getByText('Försöker…').closest('button')!;
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(auth.retryProfileLoad).toHaveBeenCalledTimes(1);

    await act(async () => { finish(); });
    expect(screen.getByText('Försök igen').closest('button')).not.toBeDisabled();
  });
});
