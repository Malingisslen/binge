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
const cta = () => screen.getAllByRole('button', { name: 'Skapa konto gratis' })[0];

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

    expect(screen.queryByRole('button', { name: 'Skapa konto gratis' })).toBeNull();
  });
});

// #26:s villkor 5 (pengakollen publikt): the guest cost demo sits under the hero and
// above "Trendande", and ONLY once auth has resolved to signed-out. The loading branch
// is also what a returning signed-in visitor gets on first paint (hidden by CSS), so
// the demo must not be in it; and it never renders for a uid.
describe('HomePageClient — guest cost demo (3B)', () => {
  const demoHeading = () => screen.queryByRole('heading', { name: 'Vad betalar du för streaming?' });

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    auth.user = null;
    auth.uid = null;
    auth.loading = false;
  });

  it('is absent while auth is loading, and appears once auth resolves signed-out', async () => {
    auth.loading = true;
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<HomePageClient />); });
    expect(demoHeading()).toBeNull();

    auth.loading = false;
    await act(async () => { view.rerender(<HomePageClient />); });
    expect(demoHeading()).not.toBeNull();
  });

  it('never renders for a signed-in visitor', async () => {
    auth.uid = 'u1';
    await act(async () => { render(<HomePageClient />); });
    expect(demoHeading()).toBeNull();
  });

  it('sits directly after the hero and before the trending section', async () => {
    await act(async () => { render(<HomePageClient initialTrending={[{ id: 1, media_type: 'movie', title: 'X' } as never]} />); });
    const demo = demoHeading()!.closest('section')!;
    const trending = screen.getByRole('heading', { name: 'Trendande just nu' }).closest('section')!;
    const hero = screen.getAllByRole('button', { name: 'Skapa konto gratis' })[0].closest('section')!;
    expect(hero.nextElementSibling).toBe(demo);
    expect(demo.compareDocumentPosition(trending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a tap gives a total and shares the selection with the calculator', async () => {
    await act(async () => { render(<HomePageClient />); });
    fireEvent.click(screen.getByRole('button', { name: 'Netflix' }));
    const figure = screen.getByTestId('money-figure');
    expect(figure).toHaveTextContent(/Per månad\s*169 kr/);
    expect(figure).toHaveTextContent(/Per år, uppskattat\s*2 028 kr/);
    expect(JSON.parse(window.sessionStorage.getItem('binge:guestProviders')!)).toEqual({ 8: null });
    expect(screen.getByRole('link', { name: 'Visa mer' })).toHaveAttribute('href', expect.stringMatching(/^\/streamingkostnad\/?$/));
    expect(screen.getByRole('link', { name: 'Fler' })).toHaveAttribute('href', expect.stringMatching(/^\/streamingkostnad\/?$/));
  });
});
