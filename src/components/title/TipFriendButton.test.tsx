// Tipsa en vän — the title-page button. Mocked hooks: this pins what the component
// sends and how it reports a refusal, not the rule (src/test/rules/tips.test.ts does).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TipFriendButton from './TipFriendButton';

const sendTip = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const captureError = vi.hoisted(() => vi.fn());
const friends = vi.hoisted(() => ({ list: [] as { uid: string; displayName: string }[], reads: 0 }));
const auth = vi.hoisted(() => ({ uid: 'me' as string | null }));
const blocked = vi.hoisted(() => new Set<string>());

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useFriends', () => ({ useFriends: () => { friends.reads += 1; return { data: friends.list, isLoading: false }; } }));
vi.mock('@/hooks/useBlockedUsers', () => ({ useBlockedUsers: () => ({ isBlocked: (u: string) => blocked.has(u) }) }));
vi.mock('@/hooks/useTips', () => ({ useTipActions: () => ({ sendTip }) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
vi.mock('@/lib/sentry', () => ({ captureError }));

function renderButton() {
  return render(<TipFriendButton tmdbId={603} mediaType="movie" title="The Matrix" />);
}

describe('TipFriendButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blocked.clear();
    friends.list = [{ uid: 'anna', displayName: 'Anna' }, { uid: 'bo', displayName: 'Bo' }];
    friends.reads = 0;
    auth.uid = 'me';
  });

  it('renders nothing for a signed-out visitor', () => {
    auth.uid = null;
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it('reads the friend list only once the picker is opened', () => {
    renderButton();
    expect(friends.reads).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Tipsa en vän/ }));
    expect(friends.reads).toBeGreaterThan(0);
  });

  it('says so when there is no friend to tip', () => {
    friends.list = [];
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Tipsa en vän/ }));
    expect(screen.getByText(/Du har inga vänner att tipsa än/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skicka tips' })).toBeNull();
  });

  it('leaves blocked friends out of the picker', () => {
    blocked.add('bo');
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Tipsa en vän/ }));
    expect(screen.getByRole('button', { name: 'Anna' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bo' })).toBeNull();
  });

  it('sends the title and note to the chosen friend and confirms it', async () => {
    sendTip.mockResolvedValue(undefined);
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Tipsa en vän/ }));
    const send = screen.getByRole('button', { name: 'Skicka tips' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Anna' }));
    fireEvent.change(screen.getByLabelText(/Hälsning/), { target: { value: 'Se den!' } });
    fireEvent.click(send);
    await waitFor(() => expect(sendTip).toHaveBeenCalledWith(
      'anna', { mediaType: 'movie', tmdbId: 603, title: 'The Matrix' }, 'Se den!',
    ));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Tipset är skickat till Anna'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refused tip shows why it may have failed and reports it', async () => {
    const err = Object.assign(new Error('denied'), { code: 'permission-denied' });
    sendTip.mockRejectedValue(err);
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Tipsa en vän/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Anna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skicka tips' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('stängt av tips');
    expect(captureError).toHaveBeenCalledWith(err, { scope: 'friends', kind: 'tip-send' });
    expect(toast).not.toHaveBeenCalled();
  });
});
