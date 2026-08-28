/**
 * The error code a refused write carries when an account deletion is already running.
 *
 * Its own module, and the reason is import weight rather than tidiness (BIN-1032). The
 * modules that THROW it reach Firestore to do it; the surfaces that only need to tell this
 * failure apart from a generic one need nothing but the string. Importing it from
 * `userDocWrite.ts` pulls `./db` → `config.ts` → `getAuth()` into every module that
 * transitively renders `ReconsentGate`, which is the whole app shell — and into its tests,
 * where it throws `auth/invalid-api-key` before a single assertion runs. A constant with
 * no dependencies belongs somewhere with no dependencies.
 *
 * Derive the throwers and the matchers rather than trusting a sentence here; an earlier
 * version of this comment named one thrower and one consumer, and both counts went stale
 * inside the same commit:
 *
 *     grep -rn "DELETION_IN_PROGRESS" src
 *
 * `src/lib/` root per `code-style.md`: pure, importable without a Firebase environment.
 */
export const DELETION_IN_PROGRESS = 'binge/deletion-in-progress';

/**
 * Is this the refusal, rather than a real failure?
 *
 * Shared rather than copied, for the same reason `isPermissionDenied` is shared one file
 * over in `WatchlistContext`: copies of one predicate drift. Every surface that has to tell
 * a refusal from a genuine failure asks here.
 *
 * Matches on the message prefix because that is the shape every thrower uses — the code,
 * a colon, then a human sentence. A non-Error rejection is by definition not ours.
 */
export function isDeletionInProgressError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(DELETION_IN_PROGRESS);
}

/**
 * What the user is told when a write is refused because their account is being deleted.
 *
 * ONE string, shared, because BIN-1038 asked one question — what does a user see when a
 * write is refused? The wording is not new: it shipped on `useMarkSeen`'s series branch on
 * 2026-08-27 and this constant is that literal, lifted so the call sites that use it cannot
 * spell it differently. WHICH sites use it, and which answer the same refusal some other
 * way on purpose, is derived from the grep above rather than claimed here.
 *
 * IT DELIBERATELY DOES NOT SAY "försök igen". The marker does not clear on its own, so every
 * retry fails identically — the same reasoning #19 Customer Support used to block BIN-1032's
 * generic message on `ReconsentGate`. Two screens must not disagree about what a refused
 * write means, and "try again" is advice that cannot work.
 */
export const DELETION_IN_PROGRESS_MESSAGE =
  'Kontot håller på att raderas. Ändringen sparades inte.';
