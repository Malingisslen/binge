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
 * convenience.
 *
 * What the server sweep does and does NOT close (corrected 2026-08-15, BIN-879 —
 * this comment used to say the gap "is closed by the server sweep instead", full
 * stop, which contradicted `docs/data-retention-policy.md` in this same repo and
 * would have been believed over it): `functions/src/retentionCleanup` reaps an
 * Auth account with no profile after 7 days, so it closes the case where the user
 * never returns ANYWHERE. It does not close the cross-device case. A marker-less
 * device merely LOADING an authenticated page recreates `users/{uid}`, and the
 * sweep's candidate test is "Auth account exists AND profile confirmed absent" —
 * so such an account leaves the candidate set permanently, not for a while.
 *
 * That gap is ACCEPTED, not open (Malin's decision 2026-08-15, ADR 0022): only
 * the account holder can trigger it, the 25 collections are already erased by the
 * time it is reachable, and starting a new deletion restarts the chain. #6 DPO
 * dissented and wanted it fixed; the dissent is preserved in ADR 0022 rather than
 * argued away. What was NOT accepted is the re-stamped consent record described
 * above — that is filed separately, and note that a change to the guarded write
 * sites in `userDocWrite.ts` cannot fix it: those read THIS marker, which is by
 * definition absent on the second device.
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
 * simply keeps today's behaviour. The server sweep covers that gap ONLY for a
 * device that never returns anywhere — see the header, and ADR 0022.
 */
export function markDeletionStarted(uid: string, startedAt: number): void {
  try {
    window.localStorage.setItem(deletionMarkerKey(uid), JSON.stringify({ startedAt }));
  } catch { /* private mode — the sweep is the backstop, but only if they never return anywhere (ADR 0022) */ }
}

/**
 * Is a deletion of `uid` started but unfinished?
 *
 * Two kinds of caller, and only one of them is a guard. The write sites read it
 * to REFUSE (see above). `deleteAccount`'s freshness preflight reads it to pick
 * which error it throws (BIN-813, Malin's decision (a) 2026-08-13): with the
 * marker down, `STALE_SESSION_PREFLIGHT`'s promise that nothing was touched is
 * false. It may never change WHETHER that gate throws — ADR 0019 condition 3
 * keeps `deleteAccount` and its retry ungated, and BIN-748's gate has to keep
 * turning away an old session with everything intact.
 *
 * Read fresh from storage on every call, deliberately — never memoised into a
 * ref. BIN-592's stale account-keyed ref is the bug that pattern produces, and
 * here a stale `false` is a resurrected profile.
 *
 * A storage that THROWS answers `false`, and the asymmetry is the opposite of
 * `tabSession`'s: a false `true` would lock someone out of an account nothing
 * ever tried to delete, while a false `false` costs only what the code already
 * does today. A browser whose `localStorage` throws could not have stored a
 * marker in the first place.
 *
 * Do NOT restore the clause that used to end that sentence — "and is caught by
 * the server sweep". A false `false` lets a guarded write through,
 * `ensureUserProfile` recreates `users/{uid}`, and the account then leaves the
 * sweep's candidate set permanently (it looks for accounts WITHOUT a profile).
 * The sweep is the backstop for a device that never returns, not for this.
 * Corrected 2026-08-15, BIN-879 / ADR 0022 — it was the load-bearing half of the
 * fail-open argument above, and it was false.
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
