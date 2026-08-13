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

/**
 * BIN-876 / ADR 0020 condition 5 — the cascade committed at least one chunk and
 * then failed.
 *
 * `applyDeletionPlan` commits in ≤450-op batches. Each batch is atomic; the run
 * of batches is not. A network drop partway through therefore erases part of the
 * account and leaves the rest, and until this constant existed the settings page
 * could not tell that apart from a failure before any write — both landed in the
 * generic branch whose text ("kontrollera anslutningen och försök igen") reads
 * as *nothing happened*.
 *
 * It cannot be recognised the way `REQUIRES_RECENT_LOGIN` is. That one works
 * only because Firebase's own SDK stamps a code we can match; a plain network
 * error carries no such marker, so the cascade has to say so itself.
 *
 * Deliberately a tag on the thrown error and nothing else — no persisted cursor,
 * no resumable plan. ADR 0016 rejected a resumable cursor for a structurally
 * similar job, and this cascade's stated principle is to ask Firestore fresh on
 * every attempt (see `src/test/rules/account-deletion.test.ts`). The signal is
 * true for THIS call only.
 */
export const CASCADE_PARTIAL = 'binge/cascade-partial';

/**
 * BIN-816 — the deletion marker was already down when this failed, so the app
 * has handed the session over to the limbo screen.
 *
 * It answers a question neither of the codes above can: `deleteAccount` can fail
 * BEFORE the marker (the token read, the freshness gate) and AFTER it (the
 * snapshot reads, the plan build, a first-chunk failure). Those two produce the
 * same generic message, but only the second one unmounts the settings page —
 * and a retry button on a component that no longer exists is a promise the UI
 * cannot keep. The integration review caught exactly that.
 */
export const DELETION_HANDED_OFF = 'binge/deletion-handed-off';

/**
 * Prefix `tag` onto whatever was thrown, keeping the original as `cause`.
 *
 * One helper for both tags. They were written out twice — same prefix, same
 * `cause` assignment, same ES2022 note — in the same change that extracted this
 * one (integration review, 2026-08-13). Idempotent, so a value that travels
 * through two taggers does not accumulate duplicates.
 */
function tagError(tag: string, err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  if (detail.includes(tag)) return err instanceof Error ? err : new Error(detail);
  const tagged = new Error(`${tag}: ${detail}`);
  // Assigned rather than passed to the constructor: `new Error(msg, { cause })`
  // needs an ES2022 lib, and this must not depend on the tsconfig target.
  (tagged as Error & { cause?: unknown }).cause = err;
  return tagged;
}

/** Append the hand-off tag to whatever `deleteAccount`'s cascade threw. */
export function markHandedOff(err: unknown): Error {
  return tagError(DELETION_HANDED_OFF, err);
}

/** Mark a failure as leaving the account partially erased. */
export function markCascadePartial(err: unknown): Error {
  return tagError(CASCADE_PARTIAL, err);
}

/** Did this failure leave the session in limbo (marker down, shell swapped)? */
export function deletionWasHandedOff(message: string): boolean {
  return message.includes(DELETION_HANDED_OFF);
}

/**
 * The four ways deleting an account can fail, as ONE classifier.
 *
 * Both surfaces that report a deletion failure — the settings section and the
 * limbo screen — branched on the same three constants in the same order, written
 * out twice. They agree today only because the preflight error deliberately
 * carries `REQUIRES_RECENT_LOGIN` as well, so the ORDER of the first two checks
 * is load-bearing; a fourth code added to one copy and not the other would
 * diverge silently. One function, two callers.
 *
 * - `preflight`      — our own freshness gate. Nothing was touched, and the UI
 *                      is allowed to promise exactly that.
 * - `recent-login`   — Firebase's own error out of `deleteUser`. The cascade ran;
 *                      the data is gone and only the identity survives.
 * - `partial`        — the cascade committed at least one chunk and then failed,
 *                      or it finished and only `deleteUser` did not.
 * - `untouched`      — every remaining path, all of which run before the first
 *                      write: the token read, the snapshot reads, the plan build,
 *                      and a first-chunk failure (which `applyDeletionPlan`
 *                      leaves untagged for precisely this reason).
 */
export type DeletionFailureKind = 'preflight' | 'recent-login' | 'partial' | 'untouched';

export function classifyDeletionFailure(message: string): DeletionFailureKind {
  if (message.includes(STALE_SESSION_PREFLIGHT)) return 'preflight';
  if (message.includes(REQUIRES_RECENT_LOGIN)) return 'recent-login';
  if (message.includes(CASCADE_PARTIAL)) return 'partial';
  return 'untouched';
}
