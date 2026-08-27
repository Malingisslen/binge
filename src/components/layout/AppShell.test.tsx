import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppShell from './AppShell';

// BIN-325: the "Hoppa till innehåll" skip link + focusable #main target are the
// only keyboard bypass-block in the app chrome and had no regression guard — they
// could be removed silently. AppShell pulls in the whole topbar/subnav/auth graph,
// so we stub the heavy collaborators and assert ONLY the skip-link wiring (the link
// exists in each branch).
//
// BIN-816 added the third branch: an account whose deletion started and never
// finished gets the limbo screen INSTEAD of the app. That swap is where Malin's
// 2026-08-13 decision — blocked from writing, not merely told — is actually
// enforced, and until this file covered it the whole branch could be deleted with
// the suite still green (test review, 2026-08-13).

const useAuthMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => useAuthMock() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/hooks/useFcmToken', () => ({ useFcmForeground: () => {} }));
vi.mock('@/hooks/useTitleLinkPrefetch', () => ({ useTitleLinkPrefetch: () => {} }));
vi.mock('@/components/ui/DuotoneFilters', () => ({ default: () => null }));
vi.mock('@/components/layout/Footer', () => ({ default: () => null }));
vi.mock('@/components/layout/AppTopbar', () => ({ default: () => null }));
vi.mock('@/components/layout/Subnav', () => ({ default: () => null }));
vi.mock('@/components/layout/MobileTabBar', () => ({ default: () => null }));
vi.mock('@/components/layout/EmailVerificationBanner', () => ({ EmailVerificationBanner: () => null }));

function expectSkipLinkWiring() {
  const link = screen.getByRole('link', { name: 'Hoppa till innehåll' });
  const main = document.getElementById('main');
  expect(main).not.toBeNull();
  expect(main!.tagName).toBe('MAIN');
  // tabIndex=-1 makes <main> a programmatic focus target so the skip link lands
  // focus there (without it the jump moves the viewport but not the focus ring).
  expect(main!.getAttribute('tabindex')).toBe('-1');
  // the actual a11y contract: the link's fragment target matches the main's id.
  expect(link.getAttribute('href')).toBe(`#${main!.id}`);
  // BIN-1033, #2 Accessibility's condition 1: a skip link placed after other focusable
  // chrome is not a skip link. The four branches share ONE `ShellChrome` now, so the
  // property that used to be four separate literals has to be asserted rather than read
  // off the source — an extraction that renders the pair anywhere but first would leave
  // every assertion above green.
  const focusable = document.body.querySelectorAll(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  expect(focusable[0]).toBe(link);
}

describe('AppShell skip link (BIN-325)', () => {
  beforeEach(() => useAuthMock.mockReset());

  it('guest-landing layout exposes a skip link targeting the focusable #main', () => {
    useAuthMock.mockReturnValue({ uid: null, loading: false });
    render(<AppShell><p>innehåll</p></AppShell>);
    expectSkipLinkWiring();
  });

  it('authenticated layout exposes the same skip link targeting the focusable #main', () => {
    useAuthMock.mockReturnValue({ uid: 'u1', loading: false });
    render(<AppShell><p>innehåll</p></AppShell>);
    expectSkipLinkWiring();
  });

  it('limbo layout exposes the same skip link targeting the focusable #main', () => {
    useAuthMock.mockReturnValue({ uid: 'u1', loading: false, deletionInProgress: true });
    render(<AppShell><p>innehåll</p></AppShell>);
    expectSkipLinkWiring();
  });
});

describe('AppShell hands a half-deleted account over to the limbo screen (BIN-816)', () => {
  beforeEach(() => useAuthMock.mockReset());

  it('renders the limbo screen INSTEAD of the page', () => {
    useAuthMock.mockReturnValue({ uid: 'u1', loading: false, deletionInProgress: true });

    render(<AppShell><p>innehåll</p></AppShell>);

    expect(screen.getByText('Din radering är påbörjad men inte klar')).toBeTruthy();
    // The load-bearing half. Showing the screen is decoration; NOT rendering the
    // app is the block — a page that never mounts cannot write.
    expect(screen.queryByText('innehåll')).toBeNull();
  });

  it('leaves an unmarked session alone', () => {
    // The control. Without it, a component that renders limbo for everyone would
    // pass the assertion above.
    useAuthMock.mockReturnValue({ uid: 'u1', loading: false, deletionInProgress: false });

    render(<AppShell><p>innehåll</p></AppShell>);

    expect(screen.getByText('innehåll')).toBeTruthy();
    expect(screen.queryByText('Din radering är påbörjad men inte klar')).toBeNull();
  });

  it('still hands over while the auth verdict is mid-flight', () => {
    // `loading: true` is the window right after a reload, before the profile has
    // landed. The limbo branch must not wait for it — the marker is already on
    // disk, and a few hundred ms of the full app is a few hundred ms of writes.
    //
    // (The earlier version of this test claimed to pin ordering against
    // `isLandingForGuest`. It could not: that branch needs `!uid` and this one
    // needs `uid`, so swapping them is a no-op. The ordering that IS load-bearing
    // — limbo before the final full-app return — is pinned by the first test in
    // this block. Test review, 2026-08-13.)
    useAuthMock.mockReturnValue({ uid: 'u1', loading: true, deletionInProgress: true });

    render(<AppShell><p>innehåll</p></AppShell>);

    expect(screen.getByText('Din radering är påbörjad men inte klar')).toBeTruthy();
    expect(screen.queryByText('innehåll')).toBeNull();
  });
});

describe('AppShell hands a returning account with no profile to the reconsent gate (BIN-909)', () => {
  beforeEach(() => useAuthMock.mockReset());

  it('renders the gate INSTEAD of the page', () => {
    useAuthMock.mockReturnValue({ uid: 'u1', loading: false, pendingReconsent: true });

    render(<AppShell><p>innehåll</p></AppShell>);

    expect(screen.getByText('Välkommen tillbaka')).toBeTruthy();
    // Same load-bearing half as the limbo block above: the app not mounting is what
    // stops `WatchlistContext`'s auto-writers reaching a uid with no profile. Showing
    // a screen is decoration.
    expect(screen.queryByText('innehåll')).toBeNull();
  });

  it('leaves a session with a profile alone', () => {
    // The control. Without it a component that gated everyone would pass the above.
    useAuthMock.mockReturnValue({ uid: 'u1', loading: false, pendingReconsent: false });

    render(<AppShell><p>innehåll</p></AppShell>);

    expect(screen.getByText('innehåll')).toBeTruthy();
    expect(screen.queryByText('Välkommen tillbaka')).toBeNull();
  });

  it('the limbo screen wins when a session is BOTH marked and gated', () => {
    // Both states are reachable at once and they want opposite screens. This ordering
    // is load-bearing in a way the limbo block's own tests cannot pin: both branches
    // need `uid`, so swapping them is NOT a no-op. An aborted deletion must never be
    // offered a "create your profile" button.
    useAuthMock.mockReturnValue({ uid: 'u1', loading: false, deletionInProgress: true, pendingReconsent: true });

    render(<AppShell><p>innehåll</p></AppShell>);

    expect(screen.getByText('Din radering är påbörjad men inte klar')).toBeTruthy();
    expect(screen.queryByText('Välkommen tillbaka')).toBeNull();
  });

  it('gate layout exposes the same skip link targeting the focusable #main', () => {
    useAuthMock.mockReturnValue({ uid: 'u1', loading: false, pendingReconsent: true });
    render(<AppShell><p>innehåll</p></AppShell>);
    expectSkipLinkWiring();
  });
});
