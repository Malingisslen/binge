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
// BIN-748: the page this tab last showed a session on — the one thing about a
// session that survives a RELOAD of the tab. Written by AuthProvider, never by
// the guard, so it is set directly here (the two-halves-together test lives in
// AuthContext.test.tsx, where the provider writes it for real). Stored without
// a trailing slash, which is how tabSession.ts normalizes both sides.
const TAB_KEY = 'binge:tabSession';

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

describe('AuthGuard — a tab that BOOTS into a just-ended session (BIN-748)', () => {
  // The corner BIN-732 left open. Its rule reads the tab's MEMORY of whether a
  // session existed, and a tab re-booting mid-sign-out has none: another tab (or
  // a revoked token) ended the session, and this one reloaded — or was opened
  // from the signed-in tab — with the departing user's URL still in the address
  // bar. Its very first verdict is `null` with nothing in memory to contradict
  // it, so it stored their page. Every case below is that boot: `loading` true,
  // then false with no uid, and NEVER a uid in between.
  async function bootSignedOut(path: string) {
    auth.loading = true;
    auth.uid = null;
    window.history.replaceState({}, '', path);
    const { rerender } = render(guard());

    auth.loading = false;
    await act(async () => { rerender(guard()); });
    return rerender;
  }

  it('remembers NOTHING when this tab had already shown a session on this page', async () => {
    // `/grupper/<id>/` is the sharp case: the group doc allows any signed-in
    // read, so an inherited return path tells the next account the group's name
    // and memberUids — and a remembered path outlives onboarding, so even a
    // brand-new account gets routed straight into it.
    window.sessionStorage.setItem(TAB_KEY, '/grupper/g-hemlig-123');
    await bootSignedOut('/grupper/g-hemlig-123/');

    expect(stored()).toBeNull();
    // Still turned away, and still told where to go — the fix changes what is
    // remembered, never whether the guard guards.
    expect(push).toHaveBeenCalledWith('/login');
    expect(screen.queryByText('hemligt')).not.toBeInTheDocument();
  });

  it('also drops a path an earlier tap left in this tab', async () => {
    // Not writing is half the job: the tab is carrying a path from before the
    // session ended, and that one belongs to the departing user too.
    window.sessionStorage.setItem(TAB_KEY, '/grupper/g-hemlig-123');
    window.sessionStorage.setItem(NEXT_KEY, '/tv/1399/');
    await bootSignedOut('/grupper/g-hemlig-123/');

    expect(stored()).toBeNull();
  });

  it('holds even when the guard mounts LONG after the verdict landed', async () => {
    // The defect the integration review caught (2026-08-05), and the reason the
    // marker is a path rather than a flag the provider retires. Guarded pages
    // under the catch-all router — `/grupper/<id>/` above all — are not in the
    // commit where `loading` flips: DynamicRouter gates dispatch on `mounted`
    // and then loads the page client through next/dynamic, so their AuthGuard
    // first renders commits later, after a chunk fetch. Mounting straight into
    // `loading: false` is that tab: nothing about the earlier verdict is left to
    // read except the marker itself.
    window.sessionStorage.setItem(TAB_KEY, '/grupper/g-hemlig-123');
    window.history.replaceState({}, '', '/grupper/g-hemlig-123/');
    auth.loading = false;
    auth.uid = null;

    await act(async () => { render(guard()); });

    expect(stored(), 'a late-mounting guard must not hand over the departing URL').toBeNull();
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('an UNMARKED tab booting signed-out is still a real bounce', async () => {
    // The negative that keeps the fix honest: a visitor who was never signed in
    // here is the BIN-645 funnel from the 25k prerendered title pages, and it
    // has to survive. This is the same boot sequence, minus the marker.
    await bootSignedOut('/bibliotek/?status=vill_se');

    expect(stored()).toBe('/bibliotek/?status=vill_se');
  });

  it('the very next guarded page is a bounce again, with the marker untouched', async () => {
    // What replaces "retire the marker at the right moment": the marker names
    // ONE page, so every other guarded page is an ordinary signed-out visit and
    // keeps its return path (BIN-645) — the funnel from the 25k prerendered
    // title pages survives the handover instead of going quiet for the rest of
    // the tab's life. Note the marker is deliberately still set here.
    window.sessionStorage.setItem(TAB_KEY, '/grupper/g-hemlig-123');
    await bootSignedOut('/grupper/g-hemlig-123/');
    expect(stored()).toBeNull();

    window.history.replaceState({}, '', '/bibliotek/?status=vill_se');
    await act(async () => { render(guard()); });

    expect(stored()).toBe('/bibliotek/?status=vill_se');
    expect(window.sessionStorage.getItem(TAB_KEY), 'the guard never writes the marker').toBe('/grupper/g-hemlig-123');
  });

  it('the marker never turns a signed-in visitor away or gets read twice', async () => {
    // A marked tab whose session is LIVE renders the page as before, and when
    // that session then ends the handover rule still holds — the two mechanisms
    // compose instead of one overriding the other.
    window.sessionStorage.setItem(TAB_KEY, '/installningar');
    auth.loading = true;
    auth.uid = null;
    window.history.replaceState({}, '', '/installningar/');
    const { rerender } = render(guard());

    auth.loading = false;
    auth.uid = 'u1';
    await act(async () => { rerender(guard()); });
    expect(screen.getByText('hemligt')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    auth.uid = null;
    await act(async () => { rerender(guard()); });
    await act(async () => { rerender(guard()); });

    expect(stored()).toBeNull();
    expect(push).toHaveBeenCalledWith('/login');
  });
});
