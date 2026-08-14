// src/components/recommendations/QuickRateModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import QuickRateModal from './QuickRateModal';
import type { WatchlistItem } from '@/types';

// BIN-611 acceptance: "a test fails if updateStatus(…, 'sedd') is called for an
// item already at 'sedd' via QuickRateModal's rating flow".
//
// planQuickRateWrite is unit-tested next to buildStatusUpdate, but that alone
// does NOT meet this: the helper only returns a verdict, and nothing forced the
// modal to obey it. Widening the consuming branch from `plan === 'rating-and-
// status'` to `plan !== 'add-as-seen'` — a plausible tidy-up, since the
// surrounding else already excludes the add case — leaves the helper's own tests
// green while restoring BIN-599's bug: a second status write on an already-'sedd'
// film is read as a rewatch by `rewatchFields` (it was called isRewatch until
// BIN-641 turned the boolean into the field fragment), and rewatchCount
// inflates once per pass through the modal. It is editable nowhere, so the
// library row reads "x2" for a film watched once, permanently.
//
// So the assertions below are on the WRITES, not on the verdict.

const watchlist = vi.hoisted(() => ({
  getItem: vi.fn<(mediaType: string, tmdbId: number) => WatchlistItem | null>(() => null),
  upsertTitle: vi.fn<(payload: Record<string, unknown>) => Promise<void>>(async () => {}),
  updateRating: vi.fn<(mediaType: string, tmdbId: number, rating: number | null) => Promise<void>>(async () => {}),
  updateStatus: vi.fn<(mediaType: string, tmdbId: number, status: string) => Promise<void>>(async () => {}),
  // Mirrors the provider's own derivation rather than hardcoding libraryKnown —
  // a literal would let these tests claim a state production cannot reach, and
  // make every gate assertion below vacuous (CollectionSection.test's pattern).
  snapshotSettled: true,
  listenerFailed: false,
  get libraryKnown(): boolean { return this.snapshotSettled && !this.listenerFailed; },
  retryListener: vi.fn(),
}));

vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/lib/tmdb/client', () => ({
  discoverMovies: vi.fn(async () => ({
    results: [{ id: 603, title: 'The Matrix', release_date: '1999-03-31', poster_path: null, genre_ids: [28] }],
  })),
  posterUrl: () => null,
}));

const seen = (over: Partial<WatchlistItem> = {}) => ({
  tmdbId: 603, mediaType: 'movie', status: 'sedd', rating: 4, ...over,
} as WatchlistItem);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

async function openModal() {
  render(<QuickRateModal open onClose={() => {}} />, { wrapper });
  // The discover query resolves before the cards render.
  await waitFor(() => expect(screen.getByText('The Matrix')).toBeInTheDocument());
}

async function rate(label: string) {
  await act(async () => { fireEvent.click(screen.getByText(label)); });
}

describe('QuickRateModal — a rating pass is not a viewing log (BIN-611 / BIN-599)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchlist.getItem.mockReturnValue(null);
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = false;
  });

  it('rates an already-seen film WITHOUT touching its status', async () => {
    watchlist.getItem.mockReturnValue(seen());
    await openModal();
    await rate('Sett 4★');

    expect(watchlist.updateRating).toHaveBeenCalledWith('movie', 603, 4);
    // The whole point: no second 'sedd' write, so `rewatchFields` never fires.
    expect(watchlist.updateStatus).not.toHaveBeenCalled();
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
  });

  it('still promotes a tracked-but-unseen film to sedd', async () => {
    watchlist.getItem.mockReturnValue(seen({ status: 'vill_se' }));
    await openModal();
    await rate('Sett 5★');

    expect(watchlist.updateRating).toHaveBeenCalledWith('movie', 603, 5);
    expect(watchlist.updateStatus).toHaveBeenCalledWith('movie', 603, 'sedd');
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
  });

  it('adds an untracked film as seen, in one write', async () => {
    await openModal();
    await rate('Sett 3★');

    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1);
    expect(watchlist.upsertTitle.mock.calls[0][0]).toMatchObject({
      tmdbId: 603, mediaType: 'movie', status: 'sedd', rating: 3,
    });
    // The add carries the rating, so no separate rating/status write follows.
    expect(watchlist.updateRating).not.toHaveBeenCalled();
    expect(watchlist.updateStatus).not.toHaveBeenCalled();
  });

  it('does not clear a stored rating when a card is skipped', async () => {
    watchlist.getItem.mockReturnValue(seen());
    await openModal();
    await act(async () => { fireEvent.click(screen.getByText('Hoppa över')); });

    expect(watchlist.updateRating).not.toHaveBeenCalled();
    expect(watchlist.updateStatus).not.toHaveBeenCalled();
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
  });
});

// BIN-643. Every verdict this modal reaches comes from `getItem`, and an unread
// library answers null for ALL of it — so `planQuickRateWrite` returns
// 'add-as-seen' for a film the user has tracked for years, and that add carries
// `current: null`: providers: [] over stored provider data, no rating carried
// forward. The gate is the only thing standing between those two facts, and it
// is invisible when it regresses — which is exactly how CollectionSection kept
// its wrong `loading` gate through a review.
describe('BIN-643 — no write while the library is unknown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The film IS tracked, and seen. Ungated, the pre-snapshot miss turns this
    // into an add-as-new — the loss this ticket exists to stop.
    watchlist.getItem.mockReturnValue(seen());
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = false;
  });

  it('holds the rating buttons while the first snapshot is in flight', async () => {
    watchlist.snapshotSettled = false;
    await openModal();

    expect(screen.getByText('Sett 5★')).toBeDisabled();
    await rate('Sett 5★');
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(watchlist.updateRating).not.toHaveBeenCalled();
    expect(watchlist.updateStatus).not.toHaveBeenCalled();
    // Said out loud, so the disabled buttons are not just dead controls.
    expect(screen.getByText(/Läser in ditt bibliotek/)).toBeInTheDocument();
  });

  it('holds them on a dead listener too, and offers a way out', async () => {
    // `loading` is false in this state and `snapshotSettled` can be true — the
    // exact pair that reads as "loaded, library empty" to anything gating on
    // either one alone.
    watchlist.listenerFailed = true;
    await openModal();

    expect(screen.getByText('Sett 4★')).toBeDisabled();
    await rate('Sett 4★');
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(watchlist.updateRating).not.toHaveBeenCalled();

    expect(screen.getByRole('alert')).toHaveTextContent(/Vi når inte ditt bibliotek/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Försök igen' })); });
    expect(watchlist.retryListener).toHaveBeenCalledTimes(1);
  });

  it('rates normally once the library is known — the control', async () => {
    // Without this, a modal that rendered nothing at all would satisfy both
    // tests above.
    await openModal();

    expect(screen.getByText('Sett 4★')).not.toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await rate('Sett 4★');
    expect(watchlist.updateRating).toHaveBeenCalledWith('movie', 603, 4);
  });
});
