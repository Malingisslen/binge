import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DeletionLimbo } from './DeletionLimbo';
import { CASCADE_PARTIAL, REQUIRES_RECENT_LOGIN, STALE_SESSION_PREFLIGHT } from '@/lib/authErrors';

// BIN-816 / ADR 0019 condition 4 + 5, and Malin's answer of 2026-08-13.
//
// Two properties matter here and neither is cosmetic:
//   · The screen offers a way to FINISH the deletion, not merely a description
//     of the state. Condition 5 is explicit that a returning, re-authenticated
//     session should attempt the removal again rather than only suppressing the
//     resurrection forever.
//   · Signing out stays reachable. The marker is uid-scoped, so someone else's
//     account on the same device is unaffected — but only if there is a way to
//     get to it. A limbo screen with one button would trap a shared device.

const auth = vi.hoisted(() => ({
  deleteAccount: vi.fn<() => Promise<void>>(async () => {}),
  signOut: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth.deleteAccount.mockReset();
  auth.deleteAccount.mockResolvedValue(undefined);
  auth.signOut.mockReset();
  auth.signOut.mockResolvedValue(undefined);
});

describe('DeletionLimbo', () => {
  it('säger vad läget är utan att påstå att kontot är borta', () => {
    render(<DeletionLimbo />);

    expect(screen.getByText('Din radering är påbörjad men inte klar')).toBeTruthy();
    // Den får inte lova att allt är raderat (det vet den inte) och inte heller
    // att ingenting är det (det är den ena lögnen BIN-876 handlar om).
    const body = document.body.textContent ?? '';
    expect(body).toContain('kontot finns kvar');
    expect(body).not.toContain('Ingenting har raderats');
  });

  it('slutför raderingen — inte bara tystar återskapandet', async () => {
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    // ADR 0019 villkor 5: en återvändande markerad session ska FÖRSÖKA igen.
    // Utan det här anropet är skärmen bara en spärr som ingen kan ta sig ur.
    expect(auth.deleteAccount).toHaveBeenCalledTimes(1);
    // Och knappen släpps. `deleteAccount` returnerar TYST utan att kasta när
    // `auth.currentUser` är null (en återkallad token mellan render och klick) —
    // det läser som framgång här, och utan det här påståendet blev skärmen
    // sittande på "Slutför…" för alltid med enda vägen ut en omladdning
    // (integrationsgranskningen 2026-08-13).
    expect(screen.getByText('Slutför raderingen')).toBeTruthy();
    expect(screen.queryByText('Slutför…')).toBeNull();
  });

  it('går att logga ut ifrån — annars fastnar en delad enhet', async () => {
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Logga ut')); });

    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('en för gammal session pekar på ny inloggning, inte på ett tekniskt fel', async () => {
    auth.deleteAccount.mockRejectedValue(
      new Error(`${REQUIRES_RECENT_LOGIN} (${STALE_SESSION_PREFLIGHT}): sessionen är för gammal`),
    );
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Logga ut, logga in igen');
    // Knappen måste bli användbar igen — annars är enda vägen ut en omladdning.
    expect(screen.getByText('Slutför raderingen')).toBeTruthy();
  });

  it('Firebases eget recent-login-fel hamnar i samma gren', async () => {
    // På DEN HÄR skärmen betyder de två koderna samma sak och har samma botemedel.
    // Till skillnad från inställningssidan finns här ingen "ingenting raderades"-
    // försäkran att få rätt: något ÄR redan borta.
    auth.deleteAccount.mockRejectedValue(new Error(`Firebase: Error (${REQUIRES_RECENT_LOGIN}).`));
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    expect(screen.getByRole('alert').textContent).toContain('Logga ut, logga in igen');
  });

  it('ett avbrott mitt i uppstädningen ber om ett nytt försök', async () => {
    auth.deleteAccount.mockRejectedValue(new Error(`${CASCADE_PARTIAL}: offline`));
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    expect(screen.getByRole('alert').textContent).toContain('kom en bit till');
  });

  it('ett okänt fel ger ett neutralt besked och låser inte knappen', async () => {
    auth.deleteAccount.mockRejectedValue(new Error('auth/network-request-failed'));
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    expect(screen.getByRole('alert').textContent).toContain('Kontrollera anslutningen');
    expect(screen.queryByText('Slutför…')).toBeNull();
  });
});
