import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { GroupInvite } from '@/lib/firebase/groups';

const state = vi.hoisted(() => ({
  invites: [] as GroupInvite[],
  decline: vi.fn<(groupId: string) => Promise<void>>(() => Promise.resolve()),
  blockUser: vi.fn<(uid: string) => Promise<{ endedFriendship: boolean }>>(() => Promise.resolve({ endedFriendship: true })),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useMyHousehold', () => ({
  useMyHousehold: () => ({ household: null, loading: false, creating: false, create: vi.fn() }),
}));
vi.mock('@/hooks/useGroups', () => ({
  useMyGroupInvites: () => ({ invites: state.invites, accept: vi.fn(), decline: state.decline }),
}));
vi.mock('@/hooks/useBlockedUsers', () => ({ useBlockedUsers: () => ({ blockUser: state.blockUser }) }));
vi.mock('@/components/groups/HouseholdConsent', () => ({ HouseholdCopy: () => null }));

import HouseholdCallout from './HouseholdCallout';

const invite = {
  groupId: 'g1', groupName: 'Hemma', kind: 'household', fromUid: 'erik', fromDisplayName: 'Erik',
} as unknown as GroupInvite;

beforeEach(() => {
  state.invites = [invite];
  state.decline.mockClear();
  state.blockUser.mockClear();
});

describe('HouseholdCallout block shortcut (BIN-1486)', () => {
  it('asks first, and blocks nothing until the person confirms', () => {
    render(<HouseholdCallout />);
    fireEvent.click(screen.getByRole('button', { name: 'Blockera' }));
    expect(screen.getByText(/avslutas er vänskap/)).toBeInTheDocument();
    expect(state.blockUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }));
    expect(state.blockUser).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Blockera' })).toBeInTheDocument();
  });

  it('blocks the sender and removes the invitation once confirmed', async () => {
    render(<HouseholdCallout />);
    fireEvent.click(screen.getByRole('button', { name: 'Blockera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, blockera' }));
    await waitFor(() => expect(state.decline).toHaveBeenCalledWith('g1'));
    expect(state.blockUser).toHaveBeenCalledWith('erik');
  });
  it('keeps the invitation when the block fails', async () => {
    state.blockUser.mockRejectedValueOnce(new Error('nope'));
    render(<HouseholdCallout />);
    fireEvent.click(screen.getByRole('button', { name: 'Blockera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, blockera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Något gick fel');
    expect(state.decline).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ja, blockera' })).toBeEnabled();
  });

  it('keeps the confirmation open for a retry when the block went through but the decline failed', async () => {
    state.decline.mockRejectedValueOnce(new Error('nope'));
    render(<HouseholdCallout />);
    fireEvent.click(screen.getByRole('button', { name: 'Blockera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, blockera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Något gick fel');
    expect(state.blockUser).toHaveBeenCalledWith('erik');
    expect(screen.getByRole('button', { name: 'Ja, blockera' })).toBeEnabled();
  });
});
