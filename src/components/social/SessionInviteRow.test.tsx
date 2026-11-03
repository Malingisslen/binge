// Bjud in till Tillsammans — one invite in the Väntar på dig box and in the bell. Mocked
// hooks: this pins the row's wording, its name lookup and what each button does, not the
// rule or the Firestore writes behind them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionInvitePopoverRow, SessionInviteRow, SESSION_GONE_TEXT } from './SessionInviteRow';
import type { SessionInvite } from '@/lib/sessionInvites';

const actions = vi.hoisted(() => ({
  join: vi.fn(),
  decline: vi.fn(),
  dismissGone: vi.fn(),
}));
const sender = vi.hoisted(() => ({ value: null as { displayName: string | null; username: string | null } | null }));
// One router object for the whole file, so a push assertion reads the same mock the row calls.
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('@/hooks/useSessionInvites', () => ({ useSessionInviteActions: () => actions }));
vi.mock('@/hooks/useSenderProfile', () => ({ useSenderProfile: () => ({ data: sender.value }) }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const INVITE: SessionInvite = {
  id: 'Sess1_anna', fromUid: 'anna', fromName: 'Anna Stored', sessionId: 'Sess1', createdAt: new Date(),
};

function renderRow(invite: SessionInvite = INVITE) {
  return render(<ul><SessionInviteRow invite={invite} /></ul>);
}

describe('SessionInviteRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sender.value = { displayName: 'Anna', username: 'anna' };
  });

  it('names the sender from their public card before the stored name', () => {
    renderRow();
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.queryByText('Anna Stored')).toBeNull();
  });

  it('falls back to the stored name when the card cannot be read', () => {
    sender.value = null;
    renderRow();
    expect(screen.getByText('Anna Stored')).toBeInTheDocument();
  });

  it('opens the session on Gå med', async () => {
    actions.join.mockResolvedValue({ status: 'open', sessionId: 'Sess1' });
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Gå med' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/tillsammans/Sess1'));
    expect(actions.join).toHaveBeenCalledWith(INVITE);
  });

  it('says the session is gone instead of opening it, and OK clears the row', async () => {
    actions.join.mockResolvedValue({ status: 'gone' });
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Gå med' }));
    expect(await screen.findByText(SESSION_GONE_TEXT)).toBeInTheDocument();
    expect(SESSION_GONE_TEXT).toBe('Sessionen finns inte längre');
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Gå med' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(actions.dismissGone).toHaveBeenCalledWith('Sess1_anna');
  });

  it('declines on Avböj', async () => {
    actions.decline.mockResolvedValue(undefined);
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Avböj' }));
    await waitFor(() => expect(actions.decline).toHaveBeenCalledWith('Sess1_anna'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('says so when a button fails, and keeps the buttons', async () => {
    actions.decline.mockRejectedValue(new Error('denied'));
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Avböj' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Det gick inte');
    expect(screen.getByRole('button', { name: 'Gå med' })).toBeInTheDocument();
  });
});

describe('SessionInvitePopoverRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sender.value = { displayName: 'Anna', username: 'anna' };
  });

  it('closes the popover before opening the session', async () => {
    actions.join.mockResolvedValue({ status: 'open', sessionId: 'Sess1' });
    const onNavigate = vi.fn();
    render(<SessionInvitePopoverRow invite={INVITE} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gå med' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/tillsammans/Sess1'));
    expect(onNavigate).toHaveBeenCalled();
  });

  it('shows the empty state without leaving the popover', async () => {
    actions.join.mockResolvedValue({ status: 'gone' });
    const onNavigate = vi.fn();
    render(<SessionInvitePopoverRow invite={INVITE} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gå med' }));
    expect(await screen.findByText(SESSION_GONE_TEXT)).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
