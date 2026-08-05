// src/components/WatchlistPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import WatchlistPage from './WatchlistPage';
import type { WatchlistItem } from '@/types';

// BIN-700 — when the watchlist listener dies terminally, BIN-601 stopped the app
// hanging on a permanent spinner: `loading` goes false. But `items` is empty, so
// the library then renders as "Inget i biblioteket än" — a confident lie to
// someone who has 300 titles, and the kind of lie that reads as "my data is
// gone". Empty beats a spinner; an honest error beats both.
//
// The naive version of this fix was tried once and reverted: it showed the empty
// library with its delete buttons still in place. So the state under test is a
// WHOLE-PAGE replacement — no list, no bulk actions — plus a retry, because a
// dead listener is the one hold that never ends on its own.

const watchlist = vi.hoisted(() => ({
  items: [] as WatchlistItem[],
  loading: false,
  // Derived as the provider derives it; the page reads listenerFailed directly.
  snapshotSettled: true,
  listenerFailed: false,
  get libraryKnown(): boolean { return this.snapshotSettled && !this.listenerFailed; },
  retryListener: vi.fn(),
  removeItem: vi.fn(async () => {}),
  updateStatus: vi.fn(async () => {}),
  updateRating: vi.fn(async () => {}),
}));

vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { myProviders: [] } }) }));
vi.mock('@/hooks/useCalendar', () => ({ useCalendarEntries: () => ({ entries: [] }) }));
vi.mock('@/hooks/useSubscriptionAdvisor', () => ({
  useSubscriptionAdvisor: () => ({
    isLoading: false,
    unfinishedTmdbIds: new Set<number>(),
    endedCaughtUpTmdbIds: new Set<number>(),
  }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/my/all/',
}));

const film = (tmdbId: number): WatchlistItem => ({
  tmdbId,
  mediaType: 'movie',
  status: 'sedd',
  title: `Film ${tmdbId}`,
  rating: null,
  providers: [],
  addedAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
  watchedAt: new Date('2024-01-02'),
  releaseYear: 1999,
  posterPath: null,
  rewatchCount: 0,
} as unknown as WatchlistItem);

beforeEach(() => {
  vi.clearAllMocks();
  watchlist.items = [];
  watchlist.loading = false;
  watchlist.snapshotSettled = true;
  watchlist.listenerFailed = false;
});

describe('BIN-700 — a dead listener says so instead of showing an empty library', () => {
  it('renders the failure with a retry, not the empty state', async () => {
    watchlist.listenerFailed = true;
    render(<WatchlistPage title="Allt" />);

    expect(screen.getByText(/Vi når inte ditt bibliotek/)).toBeInTheDocument();
    // The exact sentence the old behaviour told a user with a full library.
    expect(screen.queryByText(/Inget i biblioteket än/)).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Försök igen' })); });
    expect(watchlist.retryListener).toHaveBeenCalledTimes(1);
  });

  it('offers no destructive controls in that state', async () => {
    // The first attempt at this shipped the empty list WITH its delete buttons —
    // a confidently empty library you can act on. Nothing that writes may render
    // against a list we know is wrong.
    watchlist.listenerFailed = true;
    render(<WatchlistPage title="Allt" />);

    expect(screen.queryByRole('button', { name: 'Ta bort' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Välj' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Välj alla' })).not.toBeInTheDocument();
  });

  it('still shows the ordinary empty state when the library is genuinely empty', async () => {
    // The control: a landed snapshot of zero titles is NOT an error, and must
    // keep its "go find something to watch" nudge.
    render(<WatchlistPage title="Allt" />);

    expect(screen.getByText(/Inget i biblioteket än/)).toBeInTheDocument();
    expect(screen.queryByText(/Vi når inte ditt bibliotek/)).not.toBeInTheDocument();
  });

  it('renders the library normally when a snapshot landed', async () => {
    watchlist.items = [film(603)];
    render(<WatchlistPage title="Allt" />);

    // The default grid view renders the title twice (poster alt + caption).
    expect(screen.getAllByText('Film 603').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Vi når inte ditt bibliotek/)).not.toBeInTheDocument();
  });

  it('shows the loading view, not the error, while a retry is in flight', async () => {
    // retryListener re-subscribes: loading goes true and listenerFailed clears.
    // Reporting the failure over the top of the attempt to clear it would make
    // the button look broken.
    watchlist.loading = true;
    watchlist.listenerFailed = false;
    render(<WatchlistPage title="Allt" />);

    expect(screen.queryByText(/Vi når inte ditt bibliotek/)).not.toBeInTheDocument();
    expect(screen.getByText(/Laddar biblioteket/)).toBeInTheDocument();
  });
});
