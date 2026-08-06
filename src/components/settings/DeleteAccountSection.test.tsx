// src/components/settings/DeleteAccountSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DeleteAccountSection } from './DeleteAccountSection';
import { REQUIRES_RECENT_LOGIN, STALE_SESSION_PREFLIGHT } from '@/lib/authErrors';

// BIN-777, and the Customer Support critique that gated it (2026-08-06).
//
// Deleting an account has three failure messages, and two of them open with the
// SAME sentence: "Du måste logga in igen innan du kan ta bort ditt konto." The
// only thing separating them is the clause "Ingenting har raderats." — which is
// a promise about the person's data, not a nicety. Our own preflight throws
// before the cascade, so there the promise is true; Firebase's own
// requires-recent-login can only surface AFTER it, where the same sentence
// would be a lie.
//
// That shared prefix is exactly why a substring assertion is forbidden here: a
// mutant that swaps the two branches keeps the prefix intact, so `toContain`
// on it passes while the app tells someone nothing was deleted when their
// library is already gone. Every assertion below therefore pins the FULL
// string, and the two branches are additionally pinned by the presence and the
// absence of the promise clause.

const auth = vi.hoisted(() => ({
  deleteAccount: vi.fn<() => Promise<void>>(async () => {}),
}));
const toast = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }));

// The REAL shape AuthContext throws for our own preflight (AuthContext.tsx:991):
// it carries BOTH codes on purpose — `auth/requires-recent-login` is what every
// existing reader and Firebase itself recognise, and the preflight code is the
// only thing separating "nothing was touched" from the same error thrown after
// the cascade. A fixture carrying only the preflight code would be reachable from
// EITHER branch order, so the swap mutant this file exists to kill survives it.
// (Caught by the integration review, 2026-08-06 — the first fixture did exactly
// that and passed 5/5 against a swapped component.)
const PREFLIGHT_ERROR = `${REQUIRES_RECENT_LOGIN} (${STALE_SESSION_PREFLIGHT}): sessionen är för gammal för att radera kontot`;

const PROMISE_CLAUSE = 'Ingenting har raderats.';
const PREFLIGHT_MSG = 'Du måste logga in igen innan du kan ta bort ditt konto. Ingenting har raderats.';
const RECENT_LOGIN_MSG = 'Du måste logga in igen innan du kan ta bort ditt konto.';
const GENERIC_MSG = 'Kunde inte ta bort kontot. Kontrollera anslutningen och försök igen.';

async function attemptDelete() {
  render(<DeleteAccountSection />);
  fireEvent.click(screen.getByText('Ta bort mitt konto'));
  await act(async () => {
    fireEvent.click(screen.getByText('Ja, ta bort permanent'));
  });
}

beforeEach(() => {
  auth.deleteAccount.mockReset();
  auth.deleteAccount.mockResolvedValue(undefined);
  toast.show.mockClear();
});

describe('DeleteAccountSection — vad användaren får veta när raderingen failar', () => {
  it('vår egen förkontroll: lovar att INGENTING raderats, ordagrant', async () => {
    auth.deleteAccount.mockRejectedValue(new Error(PREFLIGHT_ERROR));

    await attemptDelete();

    expect(toast.show).toHaveBeenCalledWith(PREFLIGHT_MSG);
    // Löftesklausulen är hela skillnaden mot grannmeddelandet — pinna den
    // separat, så att en mutant som byter plats på grenarna inte kan överleva
    // på den gemensamma inledningen.
    expect(toast.show.mock.calls[0][0]).toContain(PROMISE_CLAUSE);
  });

  it('Firebases requires-recent-login: säger INTE att ingenting raderats — kaskaden kan redan ha kört', async () => {
    auth.deleteAccount.mockRejectedValue(new Error(`Firebase: Error (${REQUIRES_RECENT_LOGIN}).`));

    await attemptDelete();

    expect(toast.show).toHaveBeenCalledWith(RECENT_LOGIN_MSG);
    expect(toast.show.mock.calls[0][0]).not.toContain(PROMISE_CLAUSE);
  });

  it('okänt fel: den generiska texten, och den låtsas aldrig vara ett inloggningsfel', async () => {
    auth.deleteAccount.mockRejectedValue(new Error('auth/network-request-failed'));

    await attemptDelete();

    expect(toast.show).toHaveBeenCalledWith(GENERIC_MSG);
    // Skyddar mot att en framtida felkod tyst hamnar i den lugnande hinken:
    // den generiska grenen får aldrig be någon logga in igen.
    expect(toast.show.mock.calls[0][0]).not.toContain('logga in igen');
  });

  it('ett fel som inte är ett Error-objekt hamnar också i den generiska grenen', async () => {
    auth.deleteAccount.mockRejectedValue('bara en sträng');

    await attemptDelete();

    expect(toast.show).toHaveBeenCalledWith(GENERIC_MSG);
  });

  it('knappen går att använda igen efter ett fel — ett misslyckat försök får inte se ut som ett hängt försök', async () => {
    auth.deleteAccount.mockRejectedValue(new Error(PREFLIGHT_ERROR));

    await attemptDelete();

    // Tillbaka till utgångsläget: bekräftelsesteget stängt, ingen kvarhängande
    // "Raderar…"-knapp. Utan detta läser ett fel som att appen frusit mitt i.
    expect(screen.getByText('Ta bort mitt konto')).toBeTruthy();
    expect(screen.queryByText('Raderar…')).toBeNull();
    expect(screen.queryByText('Ja, ta bort permanent')).toBeNull();
  });
});
