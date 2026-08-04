// src/components/AuthGuard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import AuthGuard from './AuthGuard';

// BIN-669: the guard bounced signed-out visitors to /login and threw away where
// they were, so signing in from a deep link always dropped them on the home
// page. It now records the page it is bouncing off — through rememberNextPath,
// which owns the query allowlist, and after clearing, so an older tap in the
// same tab cannot outrank it.
//
// BIN-732: …but only when they were ALREADY signed out when this guard first got
// an auth verdict. The previous rule asked the AuthContext "did you call
// signOut?", which is a per-tab question with a cross-tab answer — Firebase
// broadcasts a sign-out to every tab on the origin, so a second tab parked on a
// guarded page saw `false` and stored the departing user's page anyway. There is
// therefore NO flag in this harness to set: every case below is driven by moving
// the auth state the way the app really moves it, which is the only way the two
// causes of `uid === null` are distinguishable at all.
const auth = vi.hoisted(() => ({
  uid: null as string | null,
  loading: false,
}));
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

  it('a real bounce is still remembered when the verdict arrives LATE', async () => {
    // The whole app boots `loading: true` — so "signed out when the guard first
    // got a verdict" has to mean the first pass with loading false, not the first
    // render. Reading it at mount would silence every genuine deep-link bounce,
    // which is the funnel from the 25k prerendered title pages (BIN-645).
    auth.loading = true;
    window.history.replaceState({}, '', '/bibliotek/?status=vill_se');
    const { rerender } = render(guard());

    auth.loading = false;
    await act(async () => { rerender(guard()); });

    expect(stored()).toBe('/bibliotek/?status=vill_se');
    expect(push).toHaveBeenCalledWith('/login');
  });
});

describe('AuthGuard — a session ending is a handover, not a bounce (BIN-669/732)', () => {
  // Drive the app's real boot order: the verdict is pending, then a session
  // exists, then it does not. Every case in this block is that transition —
  // which is what a sign-out looks like in EVERY tab, including the ones that
  // never called signOut() themselves.
  async function signedInThenOut(path: string) {
    auth.loading = true;
    auth.uid = null;
    window.history.replaceState({}, '', path);
    const { rerender } = render(guard());

    auth.loading = false;
    auth.uid = 'u1';
    await act(async () => { rerender(guard()); });

    auth.uid = null;
    await act(async () => { rerender(guard()); });
    return rerender;
  }

  it('a sign-out under the mounted page leaves NOTHING behind for the next account', async () => {
    // `signOut()` does not navigate, so this effect fires with the DEPARTING
    // user's own page still mounted. Remembering it hands their private URL to
    // whoever signs in next on a shared device — and because a remembered path
    // now outlives onboarding, a brand-new account gets routed straight into it.
    // `/grupper/<id>/` is not even a denied read: the group doc allows any
    // signed-in read, so the inheritor learns the group's name and memberUids.
    await signedInThenOut('/grupper/g-hemlig-123/');

    expect(stored()).toBeNull();
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('the SECOND tab behaves the same, though it never called signOut itself', async () => {
    // The BIN-732 regression proper. This tab's provider never ran signOut — it
    // only ever saw uid go set→null, because Firebase broadcast the sign-out
    // another tab performed. Under the old per-tab flag this stored the page.
    await signedInThenOut('/installningar/');

    expect(stored()).toBeNull();
  });

  it('a handover also clears a path an earlier tap had already stored', async () => {
    // The other half: not writing is not enough if something is already there.
    window.sessionStorage.setItem(NEXT_KEY, '/grupper/g-hemlig-123/');
    await signedInThenOut('/installningar/');

    expect(stored()).toBeNull();
  });

  it('survives the effect running more than once — every pass must skip', async () => {
    // The failure a consume-once reader would have: the first pass sees the
    // intent and skips, a later pass finds it spent and stores the departing
    // page after all. (This file's `useRouter: () => ({ push })` mock also hands
    // back a fresh object each call, so `router` changes identity and the dep
    // array re-fires on its own — the extra rerenders here are belt to that.)
    const rerender = await signedInThenOut('/grupper/g-hemlig-123/');
    await act(async () => { rerender(guard()); });
    await act(async () => { rerender(guard()); });

    expect(stored()).toBeNull();
  });

  it('a FRESH guard mounted after the sign-out remembers again', async () => {
    // The verdict is per guard instance, and it has to be: navigating to another
    // guarded deep link while signed out is a genuine bounce, and silencing it
    // for the rest of the tab's life is exactly the trade this fix must not make.
    await signedInThenOut('/grupper/g-hemlig-123/');
    expect(stored()).toBeNull();

    window.history.replaceState({}, '', '/bibliotek/?status=vill_se');
    await act(async () => { render(guard()); });

    expect(stored()).toBe('/bibliotek/?status=vill_se');
  });
});
