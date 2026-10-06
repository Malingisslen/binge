import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DELETION_IN_PROGRESS } from '@/lib/deletionInProgressError';
import type { MediaType, WatchlistItem } from '@/types';
import { rememberPendingAdd } from '@/lib/pendingAdd';

const auth = vi.hoisted(() => ({
  uid: 'u1' as string | null,
  user: { uid: 'u1' } as { uid: string } | null,
  loading: false,
  profileLoading: false,
}));
const watchlist = vi.hoisted(() => ({
  getItem: vi.fn<(m: MediaType, id: number) => WatchlistItem | null>(() => null),
  upsertTitle: vi.fn(async () => ({ countedRewatch: false })),
  libraryKnown: true,
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
const captureError = vi.hoisted(() => vi.fn());
const existsOnServer = vi.hoisted(() => vi.fn(async (): Promise<boolean | null> => false));
vi.mock('@/lib/firebase/pendingAddServerCheck', () => ({ existsOnServer }));
vi.mock('@/lib/sentry', () => ({ captureError }));

import PendingAddRunner from './PendingAddRunner';

const add = { tmdbId: 1399, mediaType: 'tv' as const, title: 'Game of Thrones', posterPath: null, releaseYear: 2011 };

describe('PendingAddRunner (BIN-1442)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    auth.uid = 'u1';
    auth.user = { uid: 'u1' };
    auth.profileLoading = false;
    watchlist.libraryKnown = true;
    watchlist.getItem.mockReturnValue(null);
    existsOnServer.mockResolvedValue(false);
  });

  it('adds the tapped series as Följer once signed in, and says so', async () => {
    rememberPendingAdd(add);
    render(<PendingAddRunner />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Game of Thrones — Följer'));
    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1);
    expect(watchlist.upsertTitle).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 1399, mediaType: 'tv', status: 'mina', providers: [] }));
    expect(window.sessionStorage.getItem('binge:pendingAdd')).toBeNull();
  });

  it('waits while the library is not yet known, and leaves the tap stored', () => {
    watchlist.libraryKnown = false;
    rememberPendingAdd(add);
    render(<PendingAddRunner />);
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('binge:pendingAdd')).not.toBeNull();
  });

  it('does nothing for a signed-out visitor', () => {
    auth.uid = null;
    auth.user = null;
    rememberPendingAdd(add);
    render(<PendingAddRunner />);
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
  });

  it('leaves a title already in the library untouched', () => {
    watchlist.getItem.mockReturnValue({ tmdbId: 1399, mediaType: 'tv', status: 'sedd' } as WatchlistItem);
    rememberPendingAdd(add);
    render(<PendingAddRunner />);
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  // Consent is stamped when the profile is created, so no profile means no write.
  it('waits for the profile, so nothing is written before consent', () => {
    auth.user = null;
    rememberPendingAdd(add);
    render(<PendingAddRunner />);
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('binge:pendingAdd')).not.toBeNull();
  });

  it('says so when the add fails, and reports it', async () => {
    watchlist.upsertTitle.mockRejectedValueOnce(new Error('offline'));
    rememberPendingAdd(add);
    render(<PendingAddRunner />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Kunde inte lägga till Game of Thrones. Försök igen från titelns sida.'));
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { scope: 'watchlist', kind: 'pendingAdd' });
  });

  it('stays quiet when an account deletion refuses the write', async () => {
    const err = Object.assign(new Error(DELETION_IN_PROGRESS), { code: DELETION_IN_PROGRESS });
    watchlist.upsertTitle.mockRejectedValueOnce(err);
    rememberPendingAdd(add);
    render(<PendingAddRunner />);
    await waitFor(() => expect(watchlist.upsertTitle).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 0));
    expect(captureError).not.toHaveBeenCalled();
  });

  it('runs again after a sign-out and a new sign-in as the same account', async () => {
    const view = render(<PendingAddRunner />);
    auth.uid = null; auth.user = null;
    view.rerender(<PendingAddRunner />);
    rememberPendingAdd(add);
    auth.uid = 'u1'; auth.user = { uid: 'u1' };
    view.rerender(<PendingAddRunner />);
    await waitFor(() => expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1));
  });

  // The cache can lag the server: a film marked Sedd on another device must not be
  // turned back into Vill se by a merge-write nobody chose.
  it('leaves a title the server already has untouched, even when the cache missed it', async () => {
    existsOnServer.mockResolvedValue(true);
    rememberPendingAdd(add);
    render(<PendingAddRunner />);
    await waitFor(() => expect(existsOnServer).toHaveBeenCalledWith('u1', 'tv', 1399));
    await new Promise(r => setTimeout(r, 0));
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('falls back to the cache answer when the server cannot be reached', async () => {
    existsOnServer.mockResolvedValue(null);
    rememberPendingAdd(add);
    render(<PendingAddRunner />);
    await waitFor(() => expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1));
  });
});
