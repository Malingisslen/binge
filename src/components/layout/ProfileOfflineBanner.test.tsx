// BIN-559. Remsan för en inloggad session vars profil inte gick att läsa offline.
// Kopplingen till felet och omförsöket prövas i AuthContext.test.tsx; här prövas det
// användaren ser: texten, att knappen är avstängd medan ett försök pågår, och att
// ingenting visas utan felet. BIN-1293: och vart ett lyckat omförsök skickar ett
// helt nytt konto.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

type Profile = { onboardingCompletedAt?: Date; myProviders: number[] } | null;

const auth = vi.hoisted(() => ({
  uid: 'u1' as string | null,
  user: null as { onboardingCompletedAt?: Date; myProviders: number[] } | null,
  profileLoading: false,
  profileLoadError: 'offline' as 'offline' | null,
  retryProfileLoad: vi.fn(async () => {}),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

// ETT objekt, inte en fabrik per anrop: effektens beroendelista innehåller routern.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const rememberNextPath = vi.hoisted(() => vi.fn());
const clearNextPath = vi.hoisted(() => vi.fn());
vi.mock('@/lib/nextPath', async (orig) => ({
  ...(await orig<typeof import('@/lib/nextPath')>()),
  rememberNextPath,
  clearNextPath,
}));

import { ProfileOfflineBanner } from './ProfileOfflineBanner';

beforeEach(() => {
  auth.uid = 'u1';
  auth.user = null;
  auth.profileLoading = false;
  auth.profileLoadError = 'offline';
  auth.retryProfileLoad.mockReset();
  auth.retryProfileLoad.mockImplementation(async () => {});
  router.push.mockClear();
  rememberNextPath.mockClear();
  clearNextPath.mockClear();
  window.history.replaceState(null, '', '/film/42/?tab=info');
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

describe('ProfileOfflineBanner — ett lyckat omförsök och onboardingen (BIN-1293)', () => {
  /**
   * Omförsöket som AuthContext gör: laddningen skriver profilen och rensar felet
   * INNAN löftet resolvar. `rerender` speglar att kontexten fått nya värden.
   */
  async function retryThatLoads(profile: Profile) {
    const view = render(<ProfileOfflineBanner />);
    auth.retryProfileLoad.mockImplementationOnce(async () => {
      auth.user = profile;
      auth.profileLoadError = null;
      view.rerender(<ProfileOfflineBanner />);
    });
    await act(async () => { fireEvent.click(screen.getByText('Försök igen')); });
    view.rerender(<ProfileOfflineBanner />);
    return view;
  }

  it('skickar ett helt nytt konto till onboardingen och minns sidan det stod på', async () => {
    await retryThatLoads({ myProviders: [] });

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/onboarding/');
    expect(rememberNextPath).toHaveBeenCalledWith('/film/42/?tab=info');
    expect(clearNextPath.mock.invocationCallOrder[0]).toBeLessThan(rememberNextPath.mock.invocationCallOrder[0]);
  });

  it('väntar medan en annan profilladdning pågår, och skickar när den är klar', async () => {
    const view = render(<ProfileOfflineBanner />);
    auth.retryProfileLoad.mockImplementationOnce(async () => {
      auth.user = { myProviders: [] };
      auth.profileLoadError = null;
      auth.profileLoading = true;
    });
    await act(async () => { fireEvent.click(screen.getByText('Försök igen')); });
    view.rerender(<ProfileOfflineBanner />);
    expect(router.push).not.toHaveBeenCalled();

    auth.profileLoading = false;
    await act(async () => { view.rerender(<ProfileOfflineBanner />); });
    expect(router.push).toHaveBeenCalledWith('/onboarding/');
  });

  it('skickar inte ett befintligt konto som redan gått igenom onboardingen', async () => {
    await retryThatLoads({ onboardingCompletedAt: new Date(0), myProviders: [] });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('skickar inte ett befintligt konto som har tjänster', async () => {
    await retryThatLoads({ myProviders: [8] });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('skickar ingen någonstans när omförsöket också misslyckas', async () => {
    render(<ProfileOfflineBanner />);
    await act(async () => { fireEvent.click(screen.getByText('Försök igen')); });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('gör ingenting utan ett tryck, även när en ny profil dyker upp på annat sätt', async () => {
    const view = render(<ProfileOfflineBanner />);
    auth.user = { myProviders: [] };
    auth.profileLoadError = null;
    await act(async () => { view.rerender(<ProfileOfflineBanner />); });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('ett misslyckat tryck följt av en profil från annat håll skickar ingen', async () => {
    const view = render(<ProfileOfflineBanner />);
    await act(async () => { fireEvent.click(screen.getByText('Försök igen')); });
    auth.user = { myProviders: [] };
    auth.profileLoadError = null;
    await act(async () => { view.rerender(<ProfileOfflineBanner />); });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('skickar inte vidare från en inloggningssida', async () => {
    window.history.replaceState(null, '', '/login/');
    await retryThatLoads({ myProviders: [] });
    expect(router.push).not.toHaveBeenCalled();
  });
});
