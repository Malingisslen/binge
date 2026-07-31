// src/components/title/StatusButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import StatusButton from './StatusButton';
import type { MediaType, WatchlistItem } from '@/types';

// BIN-641 — "Sedd igen" is the ONLY thing in the app that counts a rewatch.
//
// Malin, 2026-07-31. The plain 'Sedd' option renders HIGHLIGHTED when it is
// already the title's status, so a tap on it is as likely to mean "confirm" or
// "dismiss the menu" as "I watched it again". `rewatchCount` is editable
// nowhere, so a count from that gesture would be permanent and wrong. Hence a
// distinct action, and hence these tests assert on the INTENT passed to
// markSeen — not merely that a write happened.

const watchlist = vi.hoisted(() => ({
  getItem: vi.fn<(mediaType: MediaType, tmdbId: number) => WatchlistItem | null>(() => null),
  addItem: vi.fn(),
  removeItem: vi.fn(),
}));
const markSeen = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useMarkSeen', () => ({ useMarkSeen: () => markSeen }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'u1' }) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
vi.mock('@/lib/firebase/episodeProgress', () => ({ clearEpisodeProgress: vi.fn() }));

const seenFilm = {
  tmdbId: 603, mediaType: 'movie', status: 'sedd', title: 'The Matrix', rating: 4,
} as WatchlistItem;

const film = () => (
  <StatusButton tmdbId={603} mediaType="movie" title="The Matrix" posterPath={null} releaseYear={1999} />
);
const series = () => (
  <StatusButton tmdbId={1399} mediaType="tv" title="Game of Thrones" posterPath={null} releaseYear={2011} />
);

const intentOfLastMarkSeen = () => markSeen.mock.calls.at(-1)![1]?.countsAsViewing ?? false;

describe('StatusButton — "Sedd igen" (BIN-641)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchlist.getItem.mockReturnValue(seenFilm);
  });

  it('counts a rewatch when the user picks it', async () => {
    render(film());
    fireEvent.click(screen.getByRole('button', { name: 'Sedd' }));

    await act(async () => { fireEvent.click(screen.getByText('Sedd igen')); });

    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(intentOfLastMarkSeen()).toBe(true);
  });

  // The case that made this a separate action at all.
  it('counts NOTHING when the user re-picks the plain Sedd option', async () => {
    render(film());
    fireEvent.click(screen.getByRole('button', { name: 'Sedd' }));

    // The menu entry, not the trigger — both read "Sedd" for a film already seen.
    const labels = screen.getAllByText('Sedd');
    await act(async () => { fireEvent.click(labels[labels.length - 1]); });

    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(intentOfLastMarkSeen()).toBe(false);
  });

  it('is absent for a film that is not marked seen yet', () => {
    watchlist.getItem.mockReturnValue({ ...seenFilm, status: 'vill_se' } as WatchlistItem);
    render(film());
    fireEvent.click(screen.getByRole('button', { name: 'Vill se' }));

    expect(screen.queryByText('Sedd igen')).not.toBeInTheDocument();
  });

  it('is absent for an untracked title', () => {
    watchlist.getItem.mockReturnValue(null);
    render(film());
    fireEvent.click(screen.getByRole('button', { name: '+ Lägg till' }));

    expect(screen.queryByText('Sedd igen')).not.toBeInTheDocument();
  });

  // TV has no terminal 'sedd' (watchStatus.ts) — a series lands as 'mina', so a
  // rewatch cannot follow and the action would be meaningless.
  it('is absent for a series', () => {
    // Seeded as 'sedd' on purpose, so BOTH terms of the render condition are
    // pinned — a 'mina' seed would fail on the status term alone and leave the
    // media-type term free to vanish. (Unreachable in production: migrateStatus
    // maps a legacy TV 'sedd' to 'mina'.)
    watchlist.getItem.mockReturnValue({
      tmdbId: 1399, mediaType: 'tv', status: 'sedd', title: 'Game of Thrones',
    } as WatchlistItem);
    render(series());
    fireEvent.click(screen.getByRole('button', { name: 'Sedd (alla avsnitt)' }));

    expect(screen.queryByText('Sedd igen')).not.toBeInTheDocument();
  });
});
