import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppShell from './AppShell';

// BIN-325: the "Hoppa till innehåll" skip link + focusable #main target are the
// only keyboard bypass-block in the app chrome and had no regression guard — they
// could be removed silently. AppShell pulls in the whole topbar/subnav/auth graph,
// so we stub the heavy collaborators and assert ONLY the skip-link wiring, in both
// the guest-landing and authenticated layouts (the link exists in each branch).

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
});
