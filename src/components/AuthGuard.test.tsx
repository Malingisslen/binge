// src/components/AuthGuard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import AuthGuard from './AuthGuard';

// BIN-669: the guard bounced signed-out visitors to /login and threw away where
// they were, so signing in from a deep link always dropped them on the home
// page. It now records the page it is bouncing off — through rememberNextPath,
// which owns the query allowlist, and after clearing, so an older tap in the
// same tab cannot outrank it.

// `isSigningOut` defaults to false — "they were turned away" — which is the state
// every case below except the sign-out ones is about. A PREDICATE reading live
// state, not a consume-once stub: the guard reads it inside an effect, and React
// can run that effect more than once (Strict Mode mounts twice), so a consuming
// reader would answer "yes" then "no" and remember the page on the second pass.
// Modelling it as consume-once here would hide exactly that.
const auth = vi.hoisted(() => {
  const state = {
    uid: null as string | null,
    loading: false,
    signingOut: false,
    isSigningOut: () => state.signingOut,
  };
  return state;
});
const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const NEXT_KEY = 'binge:nextAfterLogin';
const stored = () => window.sessionStorage.getItem(NEXT_KEY);

const guard = () => <AuthGuard><div>hemligt</div></AuthGuard>;

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  auth.uid = null;
  auth.loading = false;
  auth.signingOut = false;
});

describe('AuthGuard — the bounce remembers the page it bounced off', () => {
  it('stores the guarded path, query included, and sends them to /login', async () => {
    // The query is the whole state of some guarded views (?status= on the
    // library); usePathname() would drop it.
    window.history.replaceState({}, '', '/bibliotek/?status=vill_se');
    await act(async () => { render(guard()); });

    expect(push).toHaveBeenCalledWith('/login');
    expect(stored()).toBe('/bibliotek/?status=vill_se');
    expect(screen.queryByText('hemligt')).not.toBeInTheDocument();
  });

  it('drops a query key that acts on mount rather than carrying it back', async () => {
    // ?invite= joins a group with no confirmation and ?fromGroup= costs a read;
    // the writer's allowlist is what keeps them out — hence going through
    // rememberNextPath instead of writing sessionStorage here.
    window.history.replaceState({}, '', '/grupper/?invite=abc&status=sedd');
    await act(async () => { render(guard()); });

    expect(stored()).toBe('/grupper/?status=sedd');
  });

  it('replaces a stale path, and leaves NOTHING when the new one is refused', async () => {
    // /onboarding is a sign-in route, so rememberNextPath declines it. Without
    // the clear, the earlier tap's path would survive and land the visitor on a
    // page they never asked for.
    window.sessionStorage.setItem(NEXT_KEY, '/tv/1399/');
    window.history.replaceState({}, '', '/onboarding/');
    await act(async () => { render(guard()); });

    expect(stored()).toBeNull();
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('writes nothing and renders the page for a signed-in visitor', async () => {
    auth.uid = 'u1';
    window.history.replaceState({}, '', '/bibliotek/');
    await act(async () => { render(guard()); });

    expect(push).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
    expect(screen.getByText('hemligt')).toBeInTheDocument();
  });

  it('waits for the auth verdict before deciding anything', async () => {
    auth.loading = true;
    window.history.replaceState({}, '', '/bibliotek/');
    await act(async () => { render(guard()); });

    // Bouncing while the verdict is still pending would log out every reload.
    expect(push).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });
});

describe('AuthGuard — leaving is not the same as being turned away (BIN-669)', () => {
  it('a deliberate sign-out leaves NOTHING behind for the next account', async () => {
    // `signOut()` does not navigate, so this effect fires with the DEPARTING
    // user's own page still mounted. Remembering it hands their private URL to
    // whoever signs in next on a shared device — and because a remembered path
    // now outlives onboarding, a brand-new account gets routed straight into it.
    auth.signingOut = true;
    window.history.replaceState({}, '', '/grupper/g-hemlig-123/');
    await act(async () => { render(guard()); });

    expect(stored()).toBeNull();
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('a sign-out also clears a path an earlier tap had already stored', async () => {
    // The other half: not writing is not enough if something is already there.
    window.sessionStorage.setItem(NEXT_KEY, '/grupper/g-hemlig-123/');
    auth.signingOut = true;
    window.history.replaceState({}, '', '/installningar/');
    await act(async () => { render(guard()); });

    expect(stored()).toBeNull();
  });

  it('survives the effect running more than once — every pass must skip', async () => {
    // The failure a consume-once reader would have: the first pass sees the
    // intent and skips, a later pass finds it spent and stores the departing
    // page after all.
    //
    // Measured, not assumed: the guarded effect already fires TWICE inside a
    // single mount here — the `mounted` bootstrap effect re-renders, and this
    // file's `useRouter: () => ({ push })` mock hands back a fresh object each
    // call, so `router` changes identity and the dep array re-fires. So the
    // sibling cases above are already double-pass; this one adds a second mount
    // on top and is deliberately belt-and-braces rather than the only guard.
    auth.signingOut = true;
    window.history.replaceState({}, '', '/grupper/g-hemlig-123/');
    await act(async () => { render(guard()); });
    await act(async () => { render(guard()); });

    expect(stored()).toBeNull();
  });

  it('once the sign-out completes, a genuine bounce is remembered again', async () => {
    // The flag covers exactly the sign-out window and no longer: `signOut` lowers
    // it in its `finally`. A flag left standing would silence every later bounce
    // in the tab, which is the failure this fix must not trade itself for.
    auth.signingOut = true;
    window.history.replaceState({}, '', '/grupper/g-hemlig-123/');
    await act(async () => { render(guard()); });
    expect(stored()).toBeNull();

    auth.signingOut = false; // signOut's finally
    window.history.replaceState({}, '', '/bibliotek/?status=vill_se');
    await act(async () => { render(guard()); });

    expect(stored()).toBe('/bibliotek/?status=vill_se');
  });
});
