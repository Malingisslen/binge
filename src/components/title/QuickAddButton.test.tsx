// src/components/title/QuickAddButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import QuickAddButton from './QuickAddButton';
import type { MediaType, WatchlistItem } from '@/types';

// BIN-645: the plus badge on poster grids used to call signIn() inline. A
// first-time Google sign-in CREATES the account, and account creation stamps
// termsAcceptedAt + ageConfirmedAt (13+) — but a grid of posters shows neither
// the villkor link nor the 13-års-notisen. So it recorded a consent the visitor
// was never shown. It now routes to /login, where those notices live, and
// remembers the page they were reading so they land back on it afterwards —
// in sessionStorage, not a ?next= param: a query would ride along to Firebase's
// Google-hosted auth handler, and would be attacker-supplied.
//
// The other half is WHO counts as signed out: `uid` (the auth verdict), never
// `user` (the Firestore profile). AuthContext deliberately keeps uid when a
// profile read fails, so keying on the profile would send an already-signed-in
// user to the login page on every tap, forever.

const auth = vi.hoisted(() => ({
  uid: 'u1' as string | null,
  // The real useAuth() returns a profile too. Without it here, the case named
  // for "no loaded profile" would encode ABSENT rather than null, and the
  // profile-keyed mutation it exists to catch would spare it.
  user: null as { uid: string } | null,
  loading: false,
  signIn: vi.fn(async () => {}),
}));
const watchlist = vi.hoisted(() => ({
  getItem: vi.fn<(mediaType: MediaType, tmdbId: number) => WatchlistItem | null>(() => null),
  addItem: vi.fn(),
  removeItem: vi.fn(),
}));
const markSeen = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useMarkSeen', () => ({ useMarkSeen: () => markSeen }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
vi.mock('@/lib/firebase/episodeProgress', () => ({ clearEpisodeProgress: vi.fn() }));

const trackedSeries = {
  tmdbId: 1399,
  mediaType: 'tv',
  status: 'mina',
  title: 'Game of Thrones',
  rating: 4.5,
} as WatchlistItem;

const button = () => (
  <QuickAddButton
    tmdbId={1399}
    mediaType="tv"
    title="Game of Thrones"
    posterPath={null}
    releaseYear={2011}
  />
);

describe('QuickAddButton — signed-out taps reach the consent notice (BIN-645)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    auth.uid = 'u1';
    auth.user = { uid: 'u1' };

    auth.loading = false;
    watchlist.getItem.mockReturnValue(trackedSeries);
  });

  it('sends a signed-out visitor to /login, carrying where they came from', async () => {
    auth.uid = null;
    watchlist.getItem.mockReturnValue(null);
    render(button());

    // The badge reads window.location, not usePathname() — it renders on /search,
    // whose whole state is the ?q= query, and usePathname() drops it.
    window.history.replaceState({}, '', '/tv/1399/?q=got');
    await act(async () => { fireEvent.click(screen.getByTitle('Lägg till')); });

    expect(push).toHaveBeenCalledWith('/login/');
    // …and the return path rides in storage, not the URL — a ?next= would travel
    // to Firebase's Google-hosted auth handler and be attacker-supplied.
    expect(window.sessionStorage.getItem('binge:nextAfterLogin')).toBe('/tv/1399/?q=got');
    // The whole point: no account is created from a surface with no notice.
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(screen.queryByText('Följ')).not.toBeInTheDocument();
  });

  it('treats a signed-in user with no loaded profile as signed IN', async () => {
    // AuthContext keeps uid and nulls the profile when the profile read fails.
    auth.uid = 'u1';
    auth.user = null;
    render(button());

    await act(async () => { fireEvent.click(screen.getByTitle('Följer')); });

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText('Följ')).toBeInTheDocument();
  });

  it('is disabled, not just inert, while auth is still restoring a session', async () => {
    auth.uid = null;
    auth.loading = true;
    watchlist.getItem.mockReturnValue(null);
    render(button());

    // Visibly disabled — an enabled button that swallows the tap reads as broken.
    const trigger = screen.getByTitle('Laddar…');
    expect(trigger).toBeDisabled();

    await act(async () => { fireEvent.click(trigger); });

    // Behind the disabled attribute jsdom fires no handler, so what these pin
    // is the ATTRIBUTE above — not the early-returns in the handler.
    expect(push).not.toHaveBeenCalled();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(screen.queryByText('Följ')).not.toBeInTheDocument();
  });

  it('still opens the menu and writes for a signed-in user', async () => {
    render(button());
    await act(async () => { fireEvent.click(screen.getByTitle('Följer')); });
    await act(async () => { fireEvent.click(screen.getByText('Följ')); });

    expect(watchlist.addItem).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});
