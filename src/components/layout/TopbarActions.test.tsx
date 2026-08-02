// src/components/layout/TopbarActions.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import TopbarActions from './TopbarActions';

// BIN-668: the topbar's "Logga in" used to call signIn() directly. A first-time
// Google sign-in CREATES the account, and account creation stamps
// termsAcceptedAt + ageConfirmedAt — but the villkor link and the 13-års notice
// only exist on /login. So the two things worth pinning here are:
//
//  1. the tap ROUTES to /login and never reaches signIn(), and
//  2. the return path is remembered INCLUDING the query string (the topbar
//     renders on /search, whose whole state is ?q=).
//
// The auth-loading case is driven as a TRANSITION rather than a single frozen
// render: a mutant that only ever shows the button while auth is unresolved, or
// one that latches it off for good, both survive a "render loading, assert
// absent" test.

const auth = vi.hoisted(() => ({
  user: null as { displayName: string; username?: string } | null,
  uid: null as string | null,
  loading: false,
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  markNotificationsSeen: vi.fn(async () => {}),
}));
const push = vi.hoisted(() => vi.fn());

// ONE router object for the whole file, the way Next's real useRouter behaves —
// a per-call factory would hand every render a fresh identity and quietly make
// any identity-sensitive assertion pass for the wrong reason.
vi.mock('next/navigation', () => {
  const router = { push };
  return { useRouter: () => router };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [], friendRequests: [], recentPicks: [],
    unreadCount: 0, friendRequestsCount: 0, providerUnreadCount: 0, recentPicksCount: 0,
    markRead: vi.fn(), markAllRead: vi.fn(),
  }),
}));
vi.mock('@/hooks/useFriends', () => ({
  useFriendActions: () => ({ acceptFriendRequest: vi.fn(), declineFriendRequest: vi.fn() }),
}));
vi.mock('@/hooks/useMySessions', () => ({ useMySessions: () => [] }));
vi.mock('@/hooks/useClickOutside', () => ({ useClickOutside: () => {} }));
vi.mock('@/hooks/useSenderProfile', () => ({ useSenderProfile: () => ({ data: null }) }));

const STORAGE_KEY = 'binge:nextAfterLogin';

describe('TopbarActions — signing in from the topbar (BIN-668)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    auth.user = null;
    auth.uid = null;
    auth.loading = false;
  });

  it('sends a signed-out visitor to /login instead of creating the account on the spot', async () => {
    window.history.replaceState({}, '', '/search?q=dune');
    await act(async () => { render(<TopbarActions />); });

    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));

    expect(push).toHaveBeenCalledWith('/login/');
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('remembers the whole address including the query, so /search comes back with its term', async () => {
    window.history.replaceState({}, '', '/search?q=dune');
    await act(async () => { render(<TopbarActions />); });

    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe('/search?q=dune');
  });

  it('offers the sign-in only after auth resolves — and does offer it once it has', async () => {
    auth.loading = true;
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<TopbarActions />); });
    expect(screen.queryByRole('button', { name: 'Logga in' })).toBeNull();

    // Drive the whole transition: the button must APPEAR when the verdict lands
    // and still route, not merely be absent while we waited.
    auth.loading = false;
    await act(async () => { view.rerender(<TopbarActions />); });

    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));
    expect(push).toHaveBeenCalledWith('/login/');
  });

  it('shows no sign-in button at all once a uid exists, even before the profile lands', async () => {
    // AuthContext keeps uid and nulls the profile when the Firestore read fails.
    // Keying this branch on `user` would offer a signed-in visitor a login trip.
    auth.uid = 'u1';
    auth.user = null;
    await act(async () => { render(<TopbarActions />); });

    expect(screen.queryByRole('button', { name: 'Logga in' })).toBeNull();
  });
});
