/**
 * The two ways a "ta bort konto"-attempt can come back as "log in again". They
 * look alike and mean opposite things, so they are two constants, in one place.
 *
 * `STALE_SESSION_PREFLIGHT` — our own gate, thrown BEFORE anything is erased
 * (BIN-748). Nothing happened; the user can re-authenticate and retry with all
 * their data intact, and the UI is allowed to promise exactly that.
 *
 * `REQUIRES_RECENT_LOGIN` — Firebase's own error out of `deleteUser`, which can
 * only reach us AFTER the Firestore cascade has run. The account's data is gone
 * and only the Auth identity survives, so the same reassurance would be a lie
 * there. Kept as its own case with deliberately non-committal wording.
 *
 * Own module rather than `AuthContext`: the settings UI needs the strings, and
 * importing the context would pull `firebase/auth` into every test that renders
 * that screen (the repo's test-extraction convention, see .claude/rules/code-style.md).
 */
export const REQUIRES_RECENT_LOGIN = 'auth/requires-recent-login';
export const STALE_SESSION_PREFLIGHT = 'binge/stale-session-preflight';
