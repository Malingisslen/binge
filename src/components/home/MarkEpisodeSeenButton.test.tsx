import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const markEpisodeWatched = vi.fn();
const isWatched = vi.fn();
let progressLoading = false;
vi.mock('@/hooks/useEpisodeProgressWithSync', () => ({
  useEpisodeProgressWithSync: () => ({ isWatched, progressLoading, markEpisodeWatched }),
}));

const toast = vi.fn();
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));

const captureError = vi.fn();
vi.mock('@/lib/sentry', () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

import MarkEpisodeSeenButton from './MarkEpisodeSeenButton';

describe('MarkEpisodeSeenButton (BIN-1442)', () => {
  beforeEach(() => {
    markEpisodeWatched.mockReset();
    isWatched.mockReset().mockReturnValue(false);
    toast.mockReset();
    captureError.mockReset();
    progressLoading = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('marks the episode seen and offers Ångra only after the write resolved', async () => {
    let resolve!: () => void;
    markEpisodeWatched.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));
    render(<MarkEpisodeSeenButton tmdbId={42} season={2} episode={5} />);

    fireEvent.click(screen.getByRole('button', { name: 'Markera S02E05 som sett' }));
    expect(markEpisodeWatched).toHaveBeenCalledWith(2, 5, true);
    expect(toast).not.toHaveBeenCalled();

    resolve();
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const [message, action] = toast.mock.calls[0];
    expect(message).toBe('Markerade S02E05 som sett');
    expect(action.label).toBe('Ångra');

    markEpisodeWatched.mockResolvedValueOnce(undefined);
    action.onClick();
    expect(markEpisodeWatched).toHaveBeenLastCalledWith(2, 5, false);
  });

  it('says so, and reports, when the write fails', async () => {
    markEpisodeWatched.mockRejectedValueOnce(new Error('offline'));
    render(<MarkEpisodeSeenButton tmdbId={42} season={2} episode={5} />);

    fireEvent.click(screen.getByRole('button', { name: 'Markera S02E05 som sett' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Kunde inte markera S02E05 som sett. Försök igen.'));
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { scope: 'watchlist', kind: 'homeMarkSeen' });
  });

  it('says so when Ångra fails', async () => {
    markEpisodeWatched.mockResolvedValueOnce(undefined);
    render(<MarkEpisodeSeenButton tmdbId={42} season={2} episode={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Markera S02E05 som sett' }));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));

    markEpisodeWatched.mockRejectedValueOnce(new Error('offline'));
    toast.mock.calls[0][1].onClick();
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith('Kunde inte ångra S02E05. Avmarkera det på seriens sida.'));
  });

  it('is hidden once the episode is watched, and while progress loads', () => {
    isWatched.mockReturnValue(true);
    const { rerender } = render(<MarkEpisodeSeenButton tmdbId={42} season={2} episode={5} />);
    expect(screen.queryByRole('button')).toBeNull();

    isWatched.mockReturnValue(false);
    progressLoading = true;
    rerender(<MarkEpisodeSeenButton tmdbId={42} season={2} episode={5} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
