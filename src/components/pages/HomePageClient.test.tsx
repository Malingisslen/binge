// src/components/pages/HomePageClient.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// BIN-668: the landing hero's "Logga in med Google" used to call signIn()
// directly. That button is the app's front door for anonymous visitors, and a
// first-time Google sign-in CREATES the account — stamping termsAcceptedAt and
// ageConfirmedAt (13+) from a hero that shows neither the villkor link nor the
// 13-års notice. It must route to /login, where both are on screen.
//
// The auth-LOADING branch matters as much as the anonymous one: HomePageClient
// renders LandingPage in BOTH (the pre-hydration pair), so a fix applied only to
// the resolved branch would leave a live signIn() behind on first paint.

// A dashboard sibling (imported at module level, never rendered on the landing
// path) transitively pulls in the Firebase config module, whose top-level
// getAuth() throws on the dummy test-env API key. Stub it — nothing on the
// tested render path touches Firebase.
vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const auth = vi.hoisted(() => ({
  user: null as { myProviders?: number[] } | null,
  uid: null as string | null,
  loading: false,
  signIn: vi.fn(async () => {}),
}));
const push = vi.hoisted(() => vi.fn());

// ONE router object for the whole file — see the note in TopbarActions.test.tsx.
vi.mock('next/navigation', () => {
  const router = { push };
  return { useRouter: () => router };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useTMDB', () => ({ useTrending: () => ({ data: undefined }) }));
vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: () => ({ items: [], loading: false }),
}));
vi.mock('@/hooks/useCalendar', () => ({
  useCalendarEntries: () => ({ entries: [], isLoading: false }),
}));
vi.mock('@/hooks/useSearchBox', () => ({
  useSearchBox: () => ({
    searchQuery: '', setSearchQuery: vi.fn(), debouncedQuery: '',
    searchFocused: false, setSearchFocused: vi.fn(),
    searchRef: { current: null }, clearSearch: vi.fn(),
  }),
}));
vi.mock('@/components/search/SearchDropdown', () => ({ default: () => null }));
vi.mock('@/components/title/TitleGrid', () => ({ default: () => null }));

import HomePageClient from './HomePageClient';

const STORAGE_KEY = 'binge:nextAfterLogin';
const cta = () => screen.getAllByRole('button', { name: 'Logga in med Google' })[0];

describe('HomePageClient — the landing sign-in CTA (BIN-668)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    auth.user = null;
    auth.uid = null;
    auth.loading = false;
  });

  it('sends an anonymous visitor to /login instead of creating the account from the hero', async () => {
    await act(async () => { render(<HomePageClient />); });

    fireEvent.click(cta());

    expect(push).toHaveBeenCalledWith('/login/');
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('remembers where to come back to', async () => {
    await act(async () => { render(<HomePageClient />); });

    fireEvent.click(cta());

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe('/');
  });

  it('routes to /login from the pre-hydration branch too, and still does once auth resolves', async () => {
    // The loading branch renders LandingPage as well (it is what crawlers and
    // first paint see). Drive it through to the resolved branch so a fix that
    // only reached one of the two cannot pass.
    auth.loading = true;
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<HomePageClient />); });

    fireEvent.click(cta());
    expect(push).toHaveBeenCalledWith('/login/');
    expect(auth.signIn).not.toHaveBeenCalled();

    auth.loading = false;
    await act(async () => { view.rerender(<HomePageClient />); });

    push.mockClear();
    fireEvent.click(cta());
    expect(push).toHaveBeenCalledWith('/login/');
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('shows no landing hero once a uid exists, even before the profile lands', async () => {
    // Keyed on uid, never on `user`: AuthContext keeps uid and nulls the profile
    // when the Firestore read fails, so a `user`-keyed branch would drop a
    // signed-in visitor back onto the anonymous landing page.
    auth.uid = 'u1';
    auth.user = null;
    await act(async () => { render(<HomePageClient />); });

    expect(screen.queryByRole('button', { name: 'Logga in med Google' })).toBeNull();
  });
});
