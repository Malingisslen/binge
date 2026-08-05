/**
 * BIN-748 — which page was THIS tab showing the last time it had a session?
 *
 * `AuthGuard` has to tell two causes of `uid === null` apart: a visitor turned
 * away from a guarded page (a bounce — remember where they were, BIN-645) and a
 * session that ended under a mounted page (a handover — remember nothing, or the
 * next account on a shared device inherits the departing user's private URL,
 * BIN-669/732). It tells them apart from whether a session existed when its
 * FIRST auth verdict landed, which is in-memory state — and that is precisely
 * what a tab starting mid-sign-out does not have.
 *
 * The corner BIN-732 left open: the sign-out happens in another tab (or the
 * token is revoked/expires), and this tab RE-BOOTS before it processed the
 * verdict — a reload, a restored/frozen tab waking up, or a tab opened from the
 * signed-in one — while still pointed at the departing user's URL. Its first
 * verdict is `null`, nothing in memory contradicts that, so the guard read it as
 * a genuine bounce and stored `/grupper/<id>/` as the next sign-in's landing
 * page. That group doc is readable by any signed-in user, so the inheritor
 * learns its name and memberUids.
 *
 * `sessionStorage`, and that IS the mechanism: it is scoped to one browsing
 * context and it survives a reload of that context. So the marker answers for
 * exactly this tab — never another tab's session, and never a stale one from a
 * browser restart. `localStorage` would answer for the whole origin and would
 * need a time window to be safe; there is no window here to get wrong.
 *
 * It stores a PATHNAME, not a bare "this tab had a session" flag, and that is
 * the load-bearing part (integrationsgranskningen 2026-08-05). A flag has to be
 * retired at some point, and the only honest moment — "this tab's own verdict is
 * now no-session" — is a React commit. Guarded pages under the catch-all router
 * (`/grupper/<id>/` above all) mount their `AuthGuard` in a LATER commit: the
 * router gates dispatch on `mounted`, then loads the page client through
 * `next/dynamic`. Their guard would have read a marker that was already gone,
 * on the exact URL the whole fix exists for. Comparing paths instead needs no
 * retirement and therefore has no ordering to lose: the marker silences the one
 * page the departing session was on, and any OTHER guarded page is a real bounce
 * that keeps its return path (BIN-645), however late its guard mounts.
 */
const KEY = 'binge:tabSession';

/** `usePathname()` and `window.location.pathname` disagree about the trailing
 *  slash depending on the route, so both sides normalize before comparing. */
function normalize(pathname: string): string {
  const path = pathname.split('?')[0].split('#')[0];
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** Record that this tab is showing a signed-in session on `pathname`. */
export function markTabSession(pathname: string): void {
  try { window.sessionStorage.setItem(KEY, normalize(pathname)); } catch { /* private mode */ }
}

/**
 * Was this tab showing a session on `pathname` — i.e. is a "no session" verdict
 * here a handover rather than a bounce? Read-only.
 *
 * A storage that THROWS answers `true`, i.e. "treat it as a handover". The two
 * outcomes are not symmetric: guessing "bounce" wrong leaks a private URL to the
 * next account, guessing "handover" wrong costs a return path — which a browser
 * whose `sessionStorage` throws could not have stored anyway (`rememberNextPath`
 * writes to the same storage).
 */
export function tabShowedSessionOn(pathname: string): boolean {
  try {
    const stored = window.sessionStorage.getItem(KEY);
    return stored !== null && stored === normalize(pathname);
  } catch { return true; }
}
