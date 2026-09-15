// src/components/social/FriendButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import FriendButton from './FriendButton';

// BIN-1129: a refused send used to be an unhandled rejection with nothing on
// screen. The rule now also refuses a sender the recipient has blocked, and the
// sender must not be able to tell that refusal from any other.

const actions = vi.hoisted(() => ({
  sendFriendRequest: vi.fn(async (_uid: string) => {}),
  cancelFriendRequest: vi.fn(async () => {}),
  acceptFriendRequest: vi.fn(async () => {}),
  removeFriend: vi.fn(async () => {}),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me' }) }));
vi.mock('@/hooks/useFriends', () => ({
  useFriendStatus: () => ({ data: 'none', isLoading: false }),
  useFriendActions: () => actions,
}));

async function clickAdd() {
  const view = render(<FriendButton targetUid="them" />);
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Lägg till vän' }));
  });
  return view;
}

describe('FriendButton — a refused send (BIN-1129)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('says the request could not be sent', async () => {
    actions.sendFriendRequest.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission-denied' }));
    const view = await clickAdd();

    expect(view.getByRole('alert').textContent).toBe('Kunde inte skicka förfrågan.');
  });

  // The same text for a refusal and for a network error: nothing in the message
  // may depend on why the write failed.
  it('shows the same text whatever the error was', async () => {
    actions.sendFriendRequest.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unavailable' }));
    const view = await clickAdd();

    expect(view.getByRole('alert').textContent).toBe('Kunde inte skicka förfrågan.');
  });

  // A retry that succeeds must clear the earlier alert. Every other case clicks
  // once, so without this one the reset before each attempt could be deleted green.
  it('clears the alert when a retry succeeds', async () => {
    actions.sendFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = await clickAdd();
    expect(view.getByRole('alert')).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Lägg till vän' }));
    });

    expect(view.queryByRole('alert')).toBeNull();
  });

  it('shows nothing when the send succeeds', async () => {
    const view = await clickAdd();

    expect(actions.sendFriendRequest).toHaveBeenCalledWith('them');
    expect(view.queryByRole('alert')).toBeNull();
  });
});
