// src/components/settings/DeleteAccountSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DeleteAccountSection } from './DeleteAccountSection';
import { REQUIRES_RECENT_LOGIN, STALE_SESSION_PREFLIGHT } from '@/lib/authErrors';

// BIN-777, and the Customer Support critique that gated it (2026-08-06).
// Wording of the recent-login branch revised by BIN-796 (Malin's call, 2026-08-07).
//
// Deleting an account has three failure messages. Two of them are about the same
// Firebase error code and mean opposite things: our own preflight throws BEFORE
// the cascade, so there "Ingenting har raderats." is true; Firebase's own
// requires-recent-login can only surface AFTER it, where that promise would be a
// lie about someone's data.
//
// Until BIN-796 the second branch handled that by saying nothing at all about
// what had happened. It shared its whole opening sentence with the first, so a
// mutant swapping the two branches kept the prefix and survived any substring
// assertion. The branches now say visibly different things — the second one
// states that deletion HAS started — but the full-string assertions below stay,
// because the risk they guard is unchanged: the failure mode is a message that
// makes a claim about the person's data that the code cannot back up. Presence
// and absence of the promise clause are pinned separately for the same reason.

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
const RECENT_LOGIN_MSG =
  'Raderingen har påbörjats men inte slutförts. Logga in igen och tryck på Ta bort mitt konto en gång till för att slutföra den.';
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
    // No action here — this branch's promise is true and needs no retry affordance.
    expect(toast.show.mock.calls[0][1]).toBeUndefined();
    // Löftesklausulen är hela skillnaden mot grannmeddelandet — pinna den
    // separat, så att en mutant som byter plats på grenarna inte kan överleva
    // på den gemensamma inledningen.
    expect(toast.show.mock.calls[0][0]).toContain(PROMISE_CLAUSE);
  });

  it('Firebases requires-recent-login: säger INTE att ingenting raderats — kaskaden kan redan ha kört', async () => {
    auth.deleteAccount.mockRejectedValue(new Error(`Firebase: Error (${REQUIRES_RECENT_LOGIN}).`));

    await attemptDelete();

    // The action argument is not decoration: a toast without one self-dismisses
    // after 2500ms, with one after 6000ms (ToastContext). This message is more
    // than twice as long as the branch that ships no action, and it is the app's
    // only notice that the library is already gone while the account remains —
    // dropping the action makes it unreadable, not just less convenient.
    expect(toast.show).toHaveBeenCalledWith(RECENT_LOGIN_MSG, {
      label: 'Försök igen',
      onClick: expect.any(Function),
    });
    expect(toast.show.mock.calls[0][0]).not.toContain(PROMISE_CLAUSE);
    // BIN-796: silence read as "nothing happened". The message must say deletion
    // started, and must not claim it finished either — both halves, or the honest
    // middle ground collapses back to one of the two lies.
    expect(toast.show.mock.calls[0][0]).toContain('påbörjats');
    expect(toast.show.mock.calls[0][0]).not.toContain('raderat');
    // There is no auto-resume — logging in only refreshes the token the preflight
    // reads. A message that stops at "logga in igen" strands the user on an empty
    // but still-existing account, so the retry action is part of the promise and
    // is pinned here (#19 Customer Support critique, 2026-08-07).
    expect(toast.show.mock.calls[0][0]).toContain('Ta bort mitt konto');
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
