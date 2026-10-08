import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
const updateNotificationSettings = vi.fn();
const auth = { uid: 'u1', user: { notificationSettings: { pushEnabled: false } }, updateNotificationSettings };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
const enablePushForUser = vi.fn();
let pushSupported = true;
vi.mock('@/lib/firebase/messaging', () => ({
  enablePushForUser: (...a: unknown[]) => enablePushForUser(...a),
  isPushSupported: () => pushSupported,
}));

import { useFirstFollowConfirmation } from './useFollowConfirmation';

describe('useFirstFollowConfirmation (BIN-1442)', () => {
  beforeEach(() => {
    toast.mockReset();
    enablePushForUser.mockReset();
    updateNotificationSettings.mockReset();
    pushSupported = true;
    auth.user.notificationSettings.pushEnabled = false;
    vi.stubGlobal('Notification', { permission: 'default' });
  });

  it('asks, and "Ja" turns push on the same way Inställningar does', async () => {
    enablePushForUser.mockResolvedValue('tok');
    updateNotificationSettings.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFirstFollowConfirmation());
    result.current('Succession', 'Succession — Följer');

    const [message, actions] = toast.mock.calls[0];
    expect(message).toBe('Du följer Succession. Vill du få en notis när nästa avsnitt släpps?');
    expect(actions.map((a: { label: string }) => a.label)).toEqual(['Ja, skicka notis', 'Inte nu']);

    actions[0].onClick();
    expect(enablePushForUser).toHaveBeenCalledWith('u1');
    await waitFor(() => expect(updateNotificationSettings).toHaveBeenCalledWith({ pushEnabled: true }));
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith('Push-notiser på'));
  });

  it('never marks push on when the browser said no', async () => {
    enablePushForUser.mockRejectedValue(new Error('Notiser inte tillåtna.'));
    const { result } = renderHook(() => useFirstFollowConfirmation());
    result.current('Succession', 'Succession — Följer');
    toast.mock.calls[0][1][0].onClick();
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith('Notiser inte tillåtna.'));
    expect(updateNotificationSettings).not.toHaveBeenCalled();
  });

  it('falls back to the plain confirmation when push is already on', () => {
    auth.user.notificationSettings.pushEnabled = true;
    const { result } = renderHook(() => useFirstFollowConfirmation());
    result.current('Succession', 'Succession — Följer');
    expect(toast).toHaveBeenCalledWith('Succession — Följer');
  });
});
