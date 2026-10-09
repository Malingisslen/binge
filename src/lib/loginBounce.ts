// A guarded page that turns a signed-out visitor away leaves this marker so /login
// can say why they landed there. sessionStorage, not a query param: it stays out of
// the URL that Firebase's Google-hosted auth handler receives (see nextPath.ts).
const KEY = 'binge:loginBounce';

export function rememberLoginBounce(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // Storage blocked: the visitor just gets no explanation line.
  }
}

/** True once per bounce; reading consumes the marker so a later visit to /login is clean. */
export function takeLoginBounce(): boolean {
  try {
    const hit = sessionStorage.getItem(KEY) === '1';
    if (hit) sessionStorage.removeItem(KEY);
    return hit;
  } catch {
    return false;
  }
}
