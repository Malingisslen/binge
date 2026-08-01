/**
 * BIN-645 — remember where a signed-out visitor was, across the sign-in trip.
 *
 * Tapping the "+" badge on a poster grid sends them to `/login/`, and afterwards
 * should land back on that title rather than the home page — it is the funnel
 * for the 25k prerendered pages.
 *
 * The path is carried in `sessionStorage`, NOT in a `?next=` query param. Three
 * reasons, all found by review of the query-param version:
 *
 *  1. **It leaves the origin.** Firebase's popup sign-in puts the full current
 *     URL into a `redirectUrl` query param on `<authDomain>/__/auth/handler`,
 *     and our authDomain is `binge-nu.firebaseapp.com` — Google-hosted, not
 *     ours. A `?next=/movie/603/` in the URL would disclose which title she was
 *     reading, cross-origin, at sign-in. sessionStorage never travels.
 *  2. **No `/login/?next=…` link exists to craft.** Nothing can write another
 *     origin's sessionStorage, so an attacker cannot hand a victim a link that
 *     aims the post-sign-in landing.
 *  3. It keeps `useSearchParams` off the login page, which under
 *     `output: 'export'` would need a Suspense boundary and leave the exported
 *     HTML — including the villkor and 13-års notice — empty until hydration.
 *
 * BUT the stored value comes from the visitor's own address bar, and an attacker
 * CAN choose that — by handing them a link to open before they tap. So the query
 * is not carried wholesale: only `RETURN_QUERY_KEYS` survive. The worst of the
 * excluded ones is `?invite=`, which joins a group on mount with no
 * confirmation; an allowlist means it cannot even be expressed here. Today that
 * page is also `AuthGuard`-wrapped so a signed-out visitor never sees the badge
 * on it — but that is a four-file coincidence, and a public route that later
 * grows a query-driven action would re-open it silently. The allowlist does not
 * depend on any of that.
 *
 * `?fromGroup=` is excluded by the same rule and is worth naming, because it is
 * NOT hypothetical: it drives group spoiler-masking, it costs a Firestore read
 * on mount, and the badge does render beside it (RecCard on a title page). The
 * cost of leaving it out is a title page that comes back unmasked — accepted.
 *
 * `safeNextPath` validates on READ as well. sessionStorage is same-origin, but
 * any script on our own origin can write it, and a stored value outlives the tap
 * that set it; validating at the point of use costs nothing.
 */

/**
 * Query keys worth returning a visitor to — everything that is pure VIEW state.
 * Add to this only after checking the key drives no action on mount.
 */
const RETURN_QUERY_KEYS = ['q', 'status', 'provider', 'row'] as const;

const KEY = 'binge:nextAfterLogin';

/**
 * Accept only a same-origin absolute path. Rejected on purpose —
 *   `https://evil.example`  scheme
 *   `//evil.example`        protocol-relative; the browser reads it as a HOST
 *   `javascript:…`          scheme, and would execute
 *   `/\evil.example`        backslash; the URL parser enters authority state on
 *                           `\` exactly as it does on `/`
 *   `evil.example`          relative — resolves against the CURRENT page, so
 *                           where it lands depends on where it was read
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw[0] !== '/') return null;
  // The SECOND character decides it: `//` and `/\` are host-relative.
  if (raw[1] === '/' || raw[1] === '\\') return null;
  // Reject control characters — a smuggled CR/LF can slip a line break past a
  // naive check upstream. A codepoint scan rather than a regex, on purpose:
  // literal control bytes in source are invisible in review, and a formatter
  // can silently eat them.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return raw;
}

/**
 * Drop every query key that is not pure view state — see RETURN_QUERY_KEYS.
 * Exported for its test; callers use `rememberNextPath`.
 */
export function stripUnsafeQuery(pathWithQuery: string): string {
  const cut = pathWithQuery.indexOf('?');
  if (cut === -1) return pathWithQuery;
  const path = pathWithQuery.slice(0, cut);
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(pathWithQuery.slice(cut + 1))) {
    if ((RETURN_QUERY_KEYS as readonly string[]).includes(key)) kept.append(key, value);
  }
  const query = kept.toString();
  return query ? `${path}?${query}` : path;
}

/** Remember where to come back to. Silently does nothing if the path is unsafe. */
export function rememberNextPath(path: string | null | undefined): void {
  const safe = safeNextPath(path);
  if (!safe) return;
  // Private mode / disabled storage throws on write — losing the return path is
  // a worse landing, never a broken sign-in.
  try { window.sessionStorage.setItem(KEY, stripUnsafeQuery(safe)); } catch { /* no-op */ }
}

/**
 * Read and CONSUME the remembered path. Single-use on purpose: a value left
 * behind would redirect the next sign-in in the same tab to a stale page.
 *
 * The try/catch is load-bearing: this runs inside LoginPage's effect, and in
 * private mode `getItem` itself throws — which would take the whole redirect
 * with it, not just the return path.
 */
export function takeNextPath(): string | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    const safe = safeNextPath(raw);
    // Strip on the way OUT too, not just on the way in. A value planted straight
    // into storage by any script on our own origin never passed the writer, so
    // a write-side-only allowlist would let its `?invite=` through — the read is
    // where the value actually gets used.
    return safe === null ? null : stripUnsafeQuery(safe);
  } catch {
    return null;
  }
}
