// src/app/login/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import LoginPage from './page';

// BIN-645: the login page is where the sign-in journey ENDS, so it owns two
// things the callers can't test.
//
// 1. The remembered return path is honoured — otherwise the whole feature is a
//    write with no read, and a signed-out tap on a title still dumps the visitor
//    on the home page.
// 2. Where a brand-new account goes instead (onboarding wins), that the stored
//    path is consumed either way, and that a second run of the effect cannot
//    overwrite the destination the first one chose.

const auth = vi.hoisted(() => ({
  user: null as { onboardingCompletedAt?: string | null; myProviders?: number[] } | null,
  uid: null as string | null,
  profileLoading: false,
  loading: false,
  signIn: vi.fn(async () => {}),
  signInEmail: vi.fn(async () => {}),
  register: vi.fn(async () => {}),
}));
const push = vi.hoisted(() => vi.fn());

// One router object for the whole file, the way Next's real useRouter behaves.
// A factory that builds `{ push }` fresh on every call hands the effect a new
// identity each render, which makes the dep array below inert — every
// dep-array case in this file would then pass for the wrong reason.
vi.mock('next/navigation', () => {
  const router = { push };
  return { useRouter: () => router };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

const returning = { onboardingCompletedAt: '2026-01-01', myProviders: [8] };
const brandNew = { onboardingCompletedAt: null, myProviders: [] };

describe('LoginPage — where you land after signing in (BIN-645)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    auth.user = null;
    auth.uid = null;
    auth.profileLoading = false;
    auth.loading = false;
  });

  it('returns a signed-in user to the page they came from', async () => {
    window.sessionStorage.setItem('binge:nextAfterLogin', '/movie/603/');
    auth.user = returning; auth.uid = 'u1';
    await act(async () => { render(<LoginPage />); });

    expect(push).toHaveBeenCalledWith('/movie/603/');
  });

  it('falls back to the home page when nothing was remembered', async () => {
    auth.user = returning; auth.uid = 'u1';
    await act(async () => { render(<LoginPage />); });

    expect(push).toHaveBeenCalledWith('/');
  });

  // A brand-new account has nothing to come back to yet, and skipping the flow
  // would leave them with no providers — so onboarding wins even when a path
  // was remembered.
  it('sends a brand-new account to onboarding regardless', async () => {
    window.sessionStorage.setItem('binge:nextAfterLogin', '/movie/603/');
    auth.user = brandNew; auth.uid = 'u1';
    await act(async () => { render(<LoginPage />); });

    expect(push).toHaveBeenCalledWith('/onboarding/');
    // …and the stored path is CONSUMED even though it was not used. Leaving it
    // would hijack the next sign-in in this tab.
    expect(window.sessionStorage.getItem('binge:nextAfterLogin')).toBeNull();
  });

  // This is what `redirectedRef` in page.tsx exists for. `takeNextPath()`
  // CONSUMES, so a second run of the effect reads null and pushes '/' over the
  // destination the first run already chose — the visitor silently loses their
  // return page. Deleting the latch fails this case with "called 2 times".
  //
  // The fixture drives the second run the way production does: a fresh `user`
  // object of the same shape, which profile hydration hands back and which the
  // `[uid, user, profileLoading, router]` dep array compares by identity. That
  // line is the only thing re-running the effect now that the router mock is
  // stable — delete it and this case proves nothing.
  it('redirects once, even when the effect runs again', async () => {
    window.sessionStorage.setItem('binge:nextAfterLogin', '/movie/603/');
    const { rerender } = render(<LoginPage />);
    expect(push).not.toHaveBeenCalled();

    auth.user = returning; auth.uid = 'u1';
    await act(async () => { rerender(<LoginPage />); });

    auth.user = { ...returning };
    await act(async () => { rerender(<LoginPage />); });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/movie/603/');
  });

  // The bug two reviewers found independently: AuthContext keeps `uid` and nulls
  // the profile when a profile read fails. Gating on `user` left that person on
  // the login FORM while signed in, with their remembered path stranded — and
  // this page is now the destination of a common tap, so it stopped being rare.
  it('redirects a signed-in visitor whose profile failed to load', async () => {
    window.sessionStorage.setItem('binge:nextAfterLogin', '/movie/603/');
    auth.uid = 'u1';
    auth.user = null;
    await act(async () => { render(<LoginPage />); });

    expect(push).toHaveBeenCalledWith('/movie/603/');
  });

  // …and it waits rather than guessing: a profile still loading cannot yet say
  // whether this account needs onboarding.
  //
  // Asserting only that the wait STARTS is not enough, and this is the one case
  // where that gap is dangerous. A version that latches on the way in —
  //     if (!uid || latched) return; latched = true; if (profileLoading) return;
  // — passes a start-only assertion while never redirecting once the flag
  // clears, and the normal boot ALWAYS renders once with it true. That mutant
  // would strand every returning visitor on the login page. So the case drives
  // the whole transition: wait, then settle, then land.
  //
  // It is also the only case that pins `profileLoading` in the dep array. On a
  // failed profile read `setUser(null)` changes no identity, so the flag going
  // true → false is the one thing left that can re-run the effect; drop it from
  // the array and nothing else in this file goes red.
  it('waits while the profile is loading, then redirects once it settles', async () => {
    window.sessionStorage.setItem('binge:nextAfterLogin', '/movie/603/');
    auth.uid = 'u1';
    auth.user = null;
    auth.profileLoading = true;
    const { rerender } = render(<LoginPage />);
    expect(push).not.toHaveBeenCalled();

    auth.profileLoading = false;
    await act(async () => { rerender(<LoginPage />); });

    expect(push).toHaveBeenCalledWith('/movie/603/');
  });

  it('does not redirect a visitor who is not signed in', async () => {
    // Seeded BEFORE the render: setting it afterwards would only prove that
    // sessionStorage works, not that the signed-out render left it alone.
    window.sessionStorage.setItem('binge:nextAfterLogin', '/movie/603/');
    await act(async () => { render(<LoginPage />); });

    expect(push).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('binge:nextAfterLogin')).toBe('/movie/603/');
  });
});
