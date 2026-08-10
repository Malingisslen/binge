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
});

describe('NotificationsSection — the box describes THIS device (BIN-844)', () => {
  it('is ticked when the account wants push and this device is registered', () => {
    render(<NotificationsSection />);
    expect((box() as HTMLInputElement).checked).toBe(true);
  });

  it('is NOT ticked when the account wants push but this device lost its token', () => {
    // The state after a sign-out and a fresh sign-in. Reading the account flag alone
    // would show a ticked box over a device that receives nothing.
    messaging.hasLocalPushToken.mockReturnValue(false);
    render(<NotificationsSection />);
    expect((box() as HTMLInputElement).checked).toBe(false);
  });

  it('is NOT ticked when the account has push off, token or not', () => {
    auth.user = { notificationSettings: { pushEnabled: false } };
    render(<NotificationsSection />);
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
      return 'tok';
    });

    render(<NotificationsSection />);
    expect((box() as HTMLInputElement).checked).toBe(false);

    await act(async () => { fireEvent.click(box()); });

    expect(messaging.enablePushForUser).toHaveBeenCalledWith('u1');
    expect((box() as HTMLInputElement).checked).toBe(true);
  });
});
