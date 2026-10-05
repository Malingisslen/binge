import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { RemovedTitle } from '@/lib/watchlist/restoreRemoved';
import { DELETION_IN_PROGRESS, DELETION_IN_PROGRESS_MESSAGE } from '@/lib/deletionInProgressError';

const removeItem = vi.fn<(m: string, id: number) => Promise<RemovedTitle | null>>();
const restoreItem = vi.fn<(r: RemovedTitle) => Promise<{ siblingsRestored: boolean }>>();
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => ({ removeItem, restoreItem }) }));
const clearEpisodeProgress = vi.fn(async () => {});
vi.mock('@/lib/firebase/episodeProgress', () => ({ clearEpisodeProgress: (...a: unknown[]) => clearEpisodeProgress(...(a as [])) }));

import { ToastProvider } from '@/contexts/ToastContext';
import { useRemoveWithUndo } from './useRemoveWithUndo';

const REMOVED: RemovedTitle = {
  mediaType: 'tv', tmdbId: 1396, docId: 'tv_1396', removalGen: 1,
  item: { tmdbId: 1396, mediaType: 'tv', status: 'mina' }, tags: null, notes: null,
};

function Remove({ owner = null }: { owner?: string | null }) {
  const removeWithUndo = useRemoveWithUndo();
  return (
    <button onClick={() => removeWithUndo({ mediaType: 'tv', tmdbId: 1396, title: 'Breaking Bad', progressOwnerUid: owner })}>
      ta bort
    </button>
  );
}

function renderIt(owner: string | null = null) {
  render(<ToastProvider><Remove owner={owner} /></ToastProvider>);
  fireEvent.click(screen.getByText('ta bort'));
}

describe('useRemoveWithUndo (BIN-1430)', () => {
  beforeEach(() => {
    removeItem.mockReset();
    restoreItem.mockReset();
    clearEpisodeProgress.mockClear();
  });

  it('removes at once and offers Ångra, which restores and only then confirms', async () => {
    removeItem.mockResolvedValue(REMOVED);
    let finish!: (v: { siblingsRestored: boolean }) => void;
    restoreItem.mockReturnValue(new Promise(r => { finish = r; }));
    renderIt();

    expect(removeItem).toHaveBeenCalledWith('tv', 1396);
    expect(screen.getByText('Breaking Bad borttagen')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ångra' })); });

    expect(restoreItem).toHaveBeenCalledWith(REMOVED);
    // The write has not answered: nothing may claim the title is back yet.
    expect(screen.queryByText('Breaking Bad är tillbaka.')).toBeNull();
    await act(async () => { finish({ siblingsRestored: true }); });
    expect(screen.getByText('Breaking Bad är tillbaka.')).toBeTruthy();
  });

  it('says the restore failed when the write is refused', async () => {
    removeItem.mockResolvedValue(REMOVED);
    restoreItem.mockRejectedValue(new Error('permission-denied'));
    renderIt();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ångra' })); });

    expect(screen.getByText('Kunde inte ångra. Lägg till titeln igen.')).toBeTruthy();
    expect(screen.queryByText(/är tillbaka/)).toBeNull();
  });

  it('says the restore failed when nothing was captured to restore', async () => {
    removeItem.mockResolvedValue(null);
    renderIt();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ångra' })); });

    expect(restoreItem).not.toHaveBeenCalled();
    expect(screen.getByText('Kunde inte ångra. Lägg till titeln igen.')).toBeTruthy();
  });

  it('gives the deletion message when the account is being deleted', async () => {
    removeItem.mockResolvedValue(REMOVED);
    restoreItem.mockRejectedValue(new Error(`${DELETION_IN_PROGRESS}: x`));
    renderIt();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ångra' })); });

    expect(screen.getByText(DELETION_IN_PROGRESS_MESSAGE)).toBeTruthy();
  });

  it('says so when the row came back without its tags or notes', async () => {
    removeItem.mockResolvedValue(REMOVED);
    restoreItem.mockResolvedValue({ siblingsRestored: false });
    renderIt();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ångra' })); });

    expect(screen.getByText('Breaking Bad är tillbaka, men taggar eller anteckning kom inte med.')).toBeTruthy();
  });

  it('a series with history gets Ångra and Rensa helt, and pressing one removes the other', async () => {
    removeItem.mockResolvedValue(REMOVED);
    renderIt('u1');

    expect(screen.getByText('Breaking Bad borttagen. Avsnittshistoriken sparas.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rensa helt' })); });

    expect(clearEpisodeProgress).toHaveBeenCalledWith('u1', 1396);
    expect(screen.queryByRole('button', { name: 'Ångra' })).toBeNull();
    expect(restoreItem).not.toHaveBeenCalled();
  });
});
