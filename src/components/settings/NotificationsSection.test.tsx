import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// BIN-844. The push checkbox used to read `notificationSettings.pushEnabled`, which
// is an ACCOUNT-level field. Now that sign-out unregisters the device without
// touching that flag, a box bound to it alone would render TICKED after the next
// sign-in while nothing arrives here — and the user would have no reason to touch
// it. That is not a cosmetic bug: it silently voids the "just re-enable it in
// Settings" cost Malin accepted when she chose to unregister on sign-out.

const auth = vi.hoisted(() => ({
  user: { notificationSettings: { pushEnabled: true } } as Record<string, unknown> | null,
  uid: 'u1' as string | null,
  updateNotificationSettings: vi.fn(async () => {}),
}));
const messaging = vi.hoisted(() => ({
  enablePushForUser: vi.fn(async () => 'tok'),
  disablePushForUser: vi.fn(async () => {}),
  isPushSupported: vi.fn(() => true),
  hasLocalPushToken: vi.fn(() => true),
  hasLivePushToken: vi.fn(async () => true),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/lib/firebase/messaging', () => messaging);

import { NotificationsSection } from './NotificationsSection';

const box = () => screen.getByRole('checkbox', { name: /push-notiser till den här enheten/i });

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { notificationSettings: { pushEnabled: true } };
  auth.uid = 'u1';
  messaging.isPushSupported.mockReturnValue(true);
  messaging.hasLocalPushToken.mockReturnValue(true);
  messaging.hasLivePushToken.mockResolvedValue(true);
});

describe('NotificationsSection — the box describes THIS device (BIN-844)', () => {
  it('is ticked when the account wants push and this device is registered', async () => {
    await act(async () => { render(<NotificationsSection />); });
    expect((box() as HTMLInputElement).checked).toBe(true);
  });

  it('is NOT ticked when the account wants push but this device lost its token', async () => {
    // The state after a sign-out and a fresh sign-in. Reading the account flag alone
    // would show a ticked box over a device that receives nothing.
    messaging.hasLocalPushToken.mockReturnValue(false);
    messaging.hasLivePushToken.mockResolvedValue(false);
    await act(async () => { render(<NotificationsSection />); });
    expect((box() as HTMLInputElement).checked).toBe(false);
  });

  it('is NOT ticked when the account has push off, token or not', async () => {
    auth.user = { notificationSettings: { pushEnabled: false } };
    await act(async () => { render(<NotificationsSection />); });
    expect((box() as HTMLInputElement).checked).toBe(false);
  });
});

// BIN-844. The effect's `busyKeys` dependency is what makes the box re-read the
// device token after a toggle settles — without it, enabling push leaves the box
// unticked until a reload, because `pushEnabled` may already have been true (a second
// device) and nothing else in the deps changes. Dropping `busyKeys` leaves the three
// tests above green, so the dep needs its own case.
describe('NotificationsSection — the box re-reads after a toggle settles (BIN-844)', () => {
  it('ticks without a reload once enabling push has written the token', async () => {
    // Second-device shape: the account already wants push, this device has none yet.
    auth.user = { notificationSettings: { pushEnabled: true } };
    messaging.hasLocalPushToken.mockReturnValue(false);
    messaging.enablePushForUser.mockImplementation(async () => {
      // What the real one does: the local pointer exists from here on.
      messaging.hasLocalPushToken.mockReturnValue(true);
      messaging.hasLivePushToken.mockResolvedValue(true);
      return 'tok';
    });

    render(<NotificationsSection />);
    expect((box() as HTMLInputElement).checked).toBe(false);

    await act(async () => { fireEvent.click(box()); });

    expect(messaging.enablePushForUser).toHaveBeenCalledWith('u1');
    expect((box() as HTMLInputElement).checked).toBe(true);
  });
});

// The pointer in localStorage is not the registration. FCM's self-heal, BIN-848's
// sweep and a sign-out delete that lands after unload all remove
// users/{uid}/fcmTokens/{id} while leaving the pointer behind — and then the box
// renders ticked over a device that receives nothing. That is the BIN-844 lie one
// door further in, so the document is the truth source now.
describe('NotificationsSection — the document decides, not the pointer', () => {
  const hint = () => screen.queryByText(/inte påslagen på den här enheten/i);

  it('un-ticks when the pointer survived but the registration is gone', async () => {
    messaging.hasLocalPushToken.mockReturnValue(true);
    messaging.hasLivePushToken.mockResolvedValue(false);

    await act(async () => { render(<NotificationsSection />); });

    expect((box() as HTMLInputElement).checked).toBe(false);
  });

  it('tells the user, rather than just showing an empty box', async () => {
    messaging.hasLocalPushToken.mockReturnValue(true);
    messaging.hasLivePushToken.mockResolvedValue(false);

    await act(async () => { render(<NotificationsSection />); });

    // An un-tick nobody caused reads as "something is wrong with my account" unless
    // the copy names a blame-free cause (#19 Customer Support's binding condition).
    expect(hint()).not.toBeNull();
    expect(hint()!.textContent).toMatch(/rensar webbläsaren/i);
  });

  it('says nothing when the device really is registered', async () => {
    await act(async () => { render(<NotificationsSection />); });
    expect((box() as HTMLInputElement).checked).toBe(true);
    expect(hint()).toBeNull();
  });

  it('says nothing when the account itself has push off', async () => {
    // Deliberately off is not "your push died" — the hint would be nagging.
    auth.user = { notificationSettings: { pushEnabled: false } };
    messaging.hasLivePushToken.mockResolvedValue(false);

    await act(async () => { render(<NotificationsSection />); });

    expect(hint()).toBeNull();
  });

  it('paints from the pointer first, so a slow read cannot blank a working box', async () => {
    // The optimistic first pass. Without it the box starts empty and flickers to
    // ticked once the read lands, on every visit to Settings.
    let release: (v: boolean) => void = () => {};
    messaging.hasLivePushToken.mockReturnValue(new Promise<boolean>(res => { release = res; }));

    render(<NotificationsSection />);
    expect((box() as HTMLInputElement).checked).toBe(true);

    await act(async () => { release(true); });
    expect((box() as HTMLInputElement).checked).toBe(true);
  });

  it('never asks about a device that holds no pointer at all', async () => {
    messaging.hasLocalPushToken.mockReturnValue(false);
    messaging.hasLivePushToken.mockResolvedValue(false);

    await act(async () => { render(<NotificationsSection />); });

    expect((box() as HTMLInputElement).checked).toBe(false);
  });
});

// The `cancelled` guard in the effect. Removing it left the whole file green until
// this block existed: nothing else here ever has two reads in flight at once, so the
// race the guard's own comment describes was never driven. It lands on the same axis
// as the rest of the ticket — a stale `false` arriving after a fresh `true` un-ticks a
// working device, and that is exactly what makes someone re-tick push and leave a
// second orphan token doc behind.
describe('NotificationsSection — a stale read cannot overwrite a newer one', () => {
  it('keeps the newer answer when an older read resolves last', async () => {
    const pending: Array<(v: boolean) => void> = [];
    messaging.hasLivePushToken.mockImplementation(
      () => new Promise<boolean>(res => { pending.push(res); }),
    );
    // The account wants push; this device has a pointer, so the box paints ticked.
    messaging.hasLocalPushToken.mockReturnValue(true);

    render(<NotificationsSection />);
    expect(pending.length).toBe(1);

    // Toggling push flips the effect's dep, so a SECOND read starts while the first
    // is still in flight.
    messaging.disablePushForUser.mockImplementation(async () => {});
    await act(async () => { fireEvent.click(box()); });
    expect(pending.length).toBeGreaterThan(1);

    // The newest read answers "still registered"...
    await act(async () => { pending[pending.length - 1](true); });
    // ...and only THEN does the first, stale one come back with the opposite.
    await act(async () => { pending[0](false); });

    // Account flag is false after the toggle, so assert on the device fact the guard
    // protects: the hint would only appear if the stale `false` had won.
    auth.user = { notificationSettings: { pushEnabled: true } };
    expect(screen.queryByText(/inte påslagen på den här enheten/i)).toBeNull();
  });
});

// The hint sits outside the `supported` branch that renders the checkbox. Without
// this case an unsupported browser shows BOTH "stöds inte i den här webbläsaren" and
// "kryssa i rutan" — pointing at a box that was never rendered.
describe('NotificationsSection — nothing to tick, nothing to say', () => {
  it('says nothing about this device when push is unsupported here', async () => {
    messaging.isPushSupported.mockReturnValue(false);
    messaging.hasLocalPushToken.mockReturnValue(false);
    messaging.hasLivePushToken.mockResolvedValue(false);

    await act(async () => { render(<NotificationsSection />); });

    expect(screen.getByText(/stöds inte i den här webbläsaren/i)).not.toBeNull();
    expect(screen.queryByText(/inte påslagen på den här enheten/i)).toBeNull();
  });
});

// The effect depends on `pushBusy`, not the whole `busyKeys` Set. The Set is shared
// by all six toggles and gets a new identity on every click, so depending on it made
// this Firestore read re-fire on clicks that cannot possibly change whether THIS
// device holds a registration. Nothing else in this file would notice the difference.
describe('NotificationsSection — an unrelated toggle costs no read', () => {
  it('does not re-check the registration when another notification toggle is clicked', async () => {
    await act(async () => { render(<NotificationsSection />); });
    const afterMount = messaging.hasLivePushToken.mock.calls.length;
    expect(afterMount).toBe(1);

    const episodes = screen.getByRole('checkbox', { name: /släpper ett nytt avsnitt/i });
    await act(async () => { fireEvent.click(episodes); });

    expect(messaging.hasLivePushToken.mock.calls.length).toBe(afterMount);
  });

  it('DOES re-check once the push toggle itself settles', async () => {
    // The other half of the same dep: narrowing it further would leave the box stale
    // until a reload, which is the BIN-844 behaviour this whole surface exists to fix.
    await act(async () => { render(<NotificationsSection />); });
    const afterMount = messaging.hasLivePushToken.mock.calls.length;

    await act(async () => { fireEvent.click(box()); });

    expect(messaging.hasLivePushToken.mock.calls.length).toBeGreaterThan(afterMount);
  });
});

// `pushEnabled` is account-level, so the hint also renders on a device that never had
// push because it was enabled on a different one. The copy must not presuppose a loss
// — an earlier draft said "slå på push igen" and named a browser wipe as the cause,
// both of which are simply false for this person.
describe('NotificationsSection — the hint also speaks to a second device', () => {
  it('does not claim this device once had push', async () => {
    // Phone has push; this laptop has never registered.
    auth.user = { notificationSettings: { pushEnabled: true } };
    messaging.hasLocalPushToken.mockReturnValue(false);
    messaging.hasLivePushToken.mockResolvedValue(false);

    await act(async () => { render(<NotificationsSection />); });

    const text = screen.getByText(/inte påslagen på den här enheten/i).textContent ?? '';
    expect(text).toMatch(/varje enhet har sin egen inställning/i);
    // Anchored on the banned phrase, not the bare substring "igen": Swedish's -ligen
    // adverb suffix (tydligen, möjligen, uppenbarligen) contains it, so an unanchored
    // match would fail on a future copy edit that changed nothing about the claim.
    expect(text).not.toMatch(/slå på push igen/i);
  });
});
