/**
 * BIN-816 / ADR 0019 — "this device asked to delete this account, and the
 * deletion is not finished".
 *
 * `deleteAccount()` erases Firestore first and removes the Firebase Auth user
 * last, because the client loses every write permission the moment the auth user
 * is gone. Anything that kills the second half — a token that aged past the
 * preflight, a dropped connection — leaves an auth account alive with its data
 * erased. The next page load then finds no `users/{uid}`, recreates it, and
 * stamps `termsAcceptedAt`/`ageConfirmedAt` with today: the app manufactures a
 * consent record for someone who just asked to leave (GDPR Art. 5(1)(d), and
 * Art. 17 for the data that comes back with it).
 *
 * This marker is what the guarded write sites read to refuse that. It is
 * **device-local on purpose** (ADR 0019, conflict 1): the alternative — a field
 * on `users/{uid}` — recreates the very document that is supposed to be gone,
 * and #5 Legal was explicit that it must not move there for cross-device
 * convenience. The cross-device / private-window / cleared-storage gap that
 * leaves is closed by the server sweep instead, not by widening this
 * (`functions/src/retentionCleanup`, ADR 0019 condition 5b), and is written down
 * in `docs/data-retention-policy.md`.
 *
 * No natural retirement. BIN-748 rejected a `localStorage` flag for a
 * structurally identical problem for exactly that reason, and this file is the
 * conscious departure from that lesson rather than an unwitting repeat of it —
 * see `.claude/rules/accepted-deviations.md`. What makes it tolerable here is
 * that the state it describes is genuinely terminal: the only way out is to
 * finish the deletion, and the server sweep finishes it even for a device that
 * never comes back.
 *
 * Pure `localStorage`, no Firebase import, so the guard is testable without a
 * Firestore environment (`.claude/rules/code-style.md`).
 */

const KEY_PREFIX = 'binge:deletionStarted:';

/**
 * The storage key for `uid`.
 *
 * ADR 0019 condition 6 asks that this be excluded from the cascade's own
 * device-local cleanup. Today it already is, by construction rather than by an
 * exclusion list: `clearAllInviteTokens` sweeps only `binge:groupInvite:`,
 * `clearPublicProfileSignature` and `clearLocalPushTokenId` remove one named key
 * each, and `clearFirestorePersistence` touches IndexedDB. The key is exported
 * so the NEXT prefix sweep has something to exclude by name instead of
 * rediscovering this constraint — clearing it mid-deletion would drop the marker
 * at the one moment it matters.
 */
export function deletionMarkerKey(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

/**
 * Record that a deletion cascade is about to run for `uid`.
 *
 * Called after the freshness preflight has passed and immediately before the
 * first Firestore write — never on the button press (ADR 0019 condition 2). A
 * marker set at click time would strand a user whose session was merely too old,
 * with nothing deleted, which is the case `STALE_SESSION_PREFLIGHT` exists to
 * keep harmless.
 *
 * Best-effort: a browser that refuses storage (private mode, disabled cookies)
 * simply keeps today's behaviour. That is the same gap the server sweep covers.
 */
export function markDeletionStarted(uid: string, startedAt: number): void {
  try {
    window.localStorage.setItem(deletionMarkerKey(uid), JSON.stringify({ startedAt }));
  } catch { /* private mode — the server sweep is the backstop */ }
}

/**
 * Is a deletion of `uid` started but unfinished?
 *
 * Read fresh from storage on every call, deliberately — never memoised into a
 * ref. BIN-592's stale account-keyed ref is the bug that pattern produces, and
 * here a stale `false` is a resurrected profile.
 *
 * A storage that THROWS answers `false`, and the asymmetry is the opposite of
 * `tabSession`'s: a false `true` would lock someone out of an account nothing
 * ever tried to delete, while a false `false` costs only what the code already
 * does today and is caught by the server sweep. A browser whose `localStorage`
 * throws could not have stored a marker in the first place.
 */
export function isDeletionStarted(uid: string): boolean {
  try {
    return window.localStorage.getItem(deletionMarkerKey(uid)) !== null;
  } catch { return false; }
}

/** When the marked deletion started, or null. Support/runbook diagnostics. */
export function deletionStartedAt(uid: string): number | null {
  try {
    const raw = window.localStorage.getItem(deletionMarkerKey(uid));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const at = (parsed as { startedAt?: unknown } | null)?.startedAt;
    return typeof at === 'number' ? at : null;
  } catch { return null; }
}

/**
 * Clear the marker. Called ONLY once `deleteUser()` has resolved — i.e. the
 * account is genuinely gone and there is nothing left to resurrect.
 *
 * There is deliberately no "I changed my mind" path: by the time this marker
 * exists the Firestore cascade has already started, so the account it would
 * un-mark no longer holds the data the user is trying to keep.
 */
export function clearDeletionStarted(uid: string): void {
  try { window.localStorage.removeItem(deletionMarkerKey(uid)); } catch { /* private mode */ }
}
