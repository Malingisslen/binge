/**
 * BIN-816 (ADR 0019 condition 5b) + BIN-875 (ADR 0020, Malin's answer 2) —
 * the server half of an aborted account deletion.
 *
 * `deleteAccount()` erases Firestore and removes the Firebase Auth user last,
 * so anything that kills the second half leaves an auth account alive with its
 * data gone. The device-local marker stops that account's profile from being
 * resurrected, but it cannot FINISH the erasure — and it does not exist at all
 * on another device, in a private window, or after the user clears site data.
 *
 * These two sweeps are what makes the surviving account a documented *delay*
 * under Art. 12(3) rather than an open-ended failure to erase. That reading is
 * Malin's decision of 2026-08-11, and it was explicitly conditional on this
 * running and on the window being written into `docs/data-retention-policy.md`.
 * If these sweeps are ever disabled, that decision no longer holds.
 *
 * With one carve-out this file must not overstate: a user who returns on a device
 * WITHOUT the deletion marker gets `users/{uid}` recreated, and from then on both
 * sweeps read the account as healthy and never touch it. The 7-day window
 * therefore bounds the user who returns nowhere. That gap is recorded as an
 * ACCEPTED gap (Malin 2026-08-15, ADR 0022, with #6 DPO dissenting on the record)
 * in `docs/data-retention-policy.md` — not as something these sweeps close. It
 * said "an open point" until BIN-879 decided it; the second clause was and stays
 * true, and is the part that matters here.
 *
 * Pure predicates only — no firebase-admin import — so the part that decides
 * what gets deleted is testable under the root vitest toolchain, like
 * `logic.ts` and `reclaimOrphanFollows/logic.ts`.
 */

/**
 * How old an auth account with no `users/{uid}` document must be before it is
 * reaped.
 *
 * Seven days, and the number is a balance of two ways to be wrong. Too short
 * and the sweep eats a live account whose profile write merely failed — a
 * signup that lost its connection between `createUserWithEmailAndPassword` and
 * the profile write, or a Google sign-in whose `ensureUserProfile` threw. Too
 * long and an erasure request sits unfinished; Art. 12(3) gives one month, and
 * a window that could reach it leaves no room for the daily cadence, a failed
 * run, or a weekend.
 *
 * Seven days is orders of magnitude beyond any transient write failure (those
 * are seconds) while leaving three weeks of headroom inside the legal window.
 * An auth account that has had no profile document for a week also has no user
 * data attached to it — the only thing lost by reaping one is an email address
 * that was never able to become an account.
 */
export const ORPHAN_AUTH_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The most accounts one run may delete before it refuses to delete any.
 *
 * Every other guard in this file answers "what if a check FAILED". This one
 * answers the question the security review asked instead: what if a check
 * succeeded and was wrong — a renamed collection, the wrong database id, an
 * inverted predicate — so that every candidate reads legitimately absent? Then
 * the fail-safe reasoning holds all the way down and the sweep deletes every
 * account older than a week, in one unrecoverable run.
 *
 * This repo's own precedent points the same way: `tmdbTosSweep` merely WRITES to
 * every user's watchlist and is gated behind an explicit `mutateEnabled` flag.
 * A ceiling is the cheap version of that for a sweep that deletes identities.
 *
 * 50 is far above any plausible day's worth of aborted deletions at this scale
 * and far below "everyone". Exceeding it logs loudly and deletes nothing, which
 * is recoverable; the alternative is not.
 */
export const ORPHAN_AUTH_MAX_PER_RUN = 50;

/**
 * The other half of the ceiling, and the half that works at THIS scale.
 *
 * An absolute 50 cannot fire while the whole user base is under 50 — which is
 * exactly where Binge is, and exactly the situation the ceiling was written for
 * (integration review, 2026-08-13). A proportional bound fires at any size: if
 * more than this fraction of the accounts we just looked at read as orphaned,
 * the reading itself is the likelier explanation.
 *
 * A quarter is deliberately loose. Aborted deletions are rare; a day where one
 * account in four has no profile document is not a busy day, it is a broken
 * query.
 */
export const ORPHAN_AUTH_MAX_FRACTION = 0.25;

/**
 * The floor under the proportional half — without it, the ceiling LATCHES.
 *
 * Three properties composed badly in the first version (security review,
 * 2026-08-13): the candidate set is monotone (an orphan stops being one only by
 * being deleted), the denominator grows only with new signups, and this project's
 * whole auth base is under 50. So a bare fraction refuses even ONE orphan at
 * three accounts, and recovery would need the user base to reach four times the
 * orphan count. Two aborted deletions in a six-account project — Malin testing
 * this flow twice — wedged the sweep permanently, with one daily `logger.error`
 * as the only signal.
 *
 * That is the exact failure the sweep exists to prevent: the auth account of
 * someone who asked to be erased survives indefinitely, and because
 * `orphanedReservations` requires the account to be gone, their handle is never
 * released either. Both halves die together.
 *
 * Five lets a small project reap a realistic day's worth while still refusing the
 * shape that means the query is broken rather than busy.
 *
 * The floor BOUNDS the latch, it does not remove it: more than five candidates
 * AND more than a quarter still refuses every run, and a wedge is cheap to plant
 * on purpose (a profile-less auth account costs one Identity-Toolkit signup
 * against the public web key). That residual is loud — one `logger.error` per
 * run — and clearable by hand; `docs/RUNBOOK.md` §5d names it.
 *
 * Note the call sites count DIFFERENT populations — accounts checked, reservations
 * checked, user roots checked. Neither number governs another. Derive the roster
 * rather than trusting a number here:
 * `grep -n "withinOrphanCeiling(" runCleanup.ts`.
 */
export const ORPHAN_AUTH_MIN_CEILING = 5;

/**
 * Should this run delete nothing because the candidate set is implausible?
 *
 * Lives here rather than in `index.ts` so the decision that gates the most
 * destructive operation in the codebase is testable without `firebase-admin` —
 * this file's stated reason for existing. It was in the handler for one round
 * and both the security and test reviews caught that changing `>` to `>=`, or
 * deleting the check outright, left the suite green.
 *
 * `checkedAccounts <= 0` disables the proportional half rather than tripping it:
 * a scan that examined nothing has no denominator, and refusing on "0 of 0" would
 * be a different bug wearing this one's clothes.
 */
export function exceedsOrphanAuthCeiling(candidates: number, checkedAccounts: number): boolean {
  // Kept as the predicate the tests drive directly; `withinOrphanCeiling` below
  // is what production calls, so the decision and the wiring are one unit.
  if (candidates > ORPHAN_AUTH_MAX_PER_RUN) return true;
  if (checkedAccounts <= 0) return false;
  return candidates > Math.max(ORPHAN_AUTH_MIN_CEILING, checkedAccounts * ORPHAN_AUTH_MAX_FRACTION);
}

/**
 * Is this auth account a candidate for the orphan sweep?
 *
 * The age test plus the one thing the age test cannot express: a DISABLED
 * account is skipped, matching `absentUidsFromLookup`'s refusal to treat
 * `disabled` as absent. `docs/moderation.md` suspends by disabling the auth user
 * and leaving Firestore alone, so it cannot bite today — but the day a moderation
 * flow also removes the profile document, an unguarded sweep would lift the ban
 * and free the email a week later (security review, 2026-08-13).
 *
 * Here rather than inline in the handler so both halves are testable without
 * firebase-admin — the same move the ceiling made for the same reason.
 */
export function isOrphanCandidate(
  user: { disabled?: boolean; metadata?: { creationTime?: unknown } },
  nowMs: number,
): boolean {
  if (user.disabled === true) return false;
  return isReapableOrphanAge(creationTimeToMillis(user.metadata?.creationTime), nowMs);
}

/**
 * Is an auth account old enough to be reaped for having no profile document?
 *
 * Negated comparison, not `>=`: an unparseable `creationTime` yields NaN, and
 * NaN must mean "leave it alone" rather than riding a silent false through to a
 * deletion. Same shape as the client's own freshness gate, for the same reason
 * — this is the one sweep in this file whose false positive destroys a live
 * person's account.
 */
export function isReapableOrphanAge(creationTimeMs: number | null, nowMs: number): boolean {
  if (creationTimeMs === null || Number.isNaN(creationTimeMs)) return false;
  return nowMs - creationTimeMs > ORPHAN_AUTH_MIN_AGE_MS;
}

/** Parse an Admin-SDK `metadata.creationTime` string. Null when unusable. */
export function creationTimeToMillis(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The uids a `getUsers()` response says Auth does not know AT ALL.
 *
 * Deliberately NOT `revokedUidsFromLookup`, which also counts `disabled: true`.
 * A disabled account still exists and still owns its handle; releasing that
 * username would hand a suspended person's identity to someone else. The
 * question here is existence, and only the response's own `notFound` list
 * answers it — absence from `users` is not evidence, because a batch that
 * failed returns nothing either.
 */
export function absentUidsFromLookup(result: {
  users: readonly { uid: string }[];
  notFound: readonly object[];
}): string[] {
  const out: string[] = [];
  for (const id of result.notFound) {
    const uid = (id as { uid?: unknown }).uid;
    if (typeof uid === 'string' && uid.length > 0) out.push(uid);
  }
  return out;
}

/**
 * Decide which username reservations may be released.
 *
 * A reservation is an orphan only when BOTH checks came back *confirmed
 * absent*: no `users/{uid}` document and no auth account. Either check merely
 * failing means "could not verify", which is not "gone" — the zero-result
 * reading that has bitten this repo before (BIN-848's `checkedUids`, and the
 * `usernames` guarantee in `docs/data-retention-policy.md` that this sweep
 * exists to keep true).
 *
 * Requiring both is also what keeps it out of the way of a user who is merely
 * mid-retry: while their auth account lives, their own next attempt is the one
 * that releases the handle. Only once the auth sweep has removed that account
 * does this one take over, on the following run.
 *
 * @param reservations   every `usernames/*` doc seen, with the uid it points at
 * @param profileMissing uids CONFIRMED to have no `users/{uid}` document
 * @param authMissing    uids CONFIRMED absent from Firebase Auth
 */
export function orphanedReservations<T extends { name: string; uid: string }>(
  reservations: readonly T[],
  profileMissing: ReadonlySet<string>,
  authMissing: ReadonlySet<string>,
): T[] {
  return reservations.filter(r => profileMissing.has(r.uid) && authMissing.has(r.uid));
}

/**
 * Apply the ceiling and hand back what may actually be deleted.
 *
 * The boolean above was the whole decision, but the *wiring* around it lived in
 * the firebase-admin handler where nothing can test it — deleting either `if`
 * left the suite green, three reviews running (security, rounds 2–4). Returning
 * the filtered set moves that last inch under the harness: production deletes
 * `allowed`, so a bypass has to change what it iterates rather than drop a
 * guard clause.
 */
export function withinOrphanCeiling<T>(
  items: readonly T[],
  checked: number,
): { allowed: T[]; refused: boolean } {
  const refused = exceedsOrphanAuthCeiling(items.length, checked);
  return { allowed: refused ? [] : [...items], refused };
}

/**
 * BIN-1023 — how long a uid must have been OBSERVED as absent from Firebase
 * Auth before its Firestore data is erased.
 *
 * NAME THE CLOCK. `ORPHAN_AUTH_MIN_AGE_MS` above measures the auth account's own
 * creation time, and that quantity does not exist here: the account is gone, so
 * there is no age left to read. Reusing the constant would be measuring a
 * different thing with the same number. This one measures OUR OWN observation —
 * how long ago the first run recorded this uid as confirmed-absent, stored in
 * `orphanWatch/{uid}`.
 *
 * The seven days above buy something specific: a live person whose profile write
 * merely failed keeps their account. That person cannot exist here — Auth's own
 * `notFound` list says the uid does not exist, so there is nobody left to
 * protect from a false positive of THAT shape. What this floor buys instead is a
 * second, independent observation on a later run: a lookup that was wrong once
 * (a bad batch, a wrong project id) does not survive being asked again a day
 * later, and the watch record is cleared the moment the uid reads present.
 *
 * Three days, not seven, and the difference is deliberate. It guarantees at
 * least two daily runs even if one run fails entirely and the next falls on a
 * weekend, while leaving four weeks inside the one month Art. 12(3) allows.
 * Longer would delay an erasure that, unlike the sibling sweep's, is already
 * overdue the moment it is detectable: a uid with no auth account is a person
 * whose account is already gone.
 */
export const ORPHAN_DATA_MIN_OBSERVED_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Has this uid been confirmed absent from Auth for long enough to erase?
 *
 * Negated comparison rather than `>=`, matching `isReapableOrphanAge`: a missing
 * or unparseable `firstSeenAt` yields null/NaN, and that must mean "leave it
 * alone and stamp it again" rather than riding a silent false through to a
 * recursive delete of someone's whole account tree.
 *
 * `null` is the FIRST observation — this run records it and deletes nothing.
 */
export function isObservedLongEnough(firstSeenAtMs: number | null, nowMs: number): boolean {
  if (firstSeenAtMs === null || Number.isNaN(firstSeenAtMs)) return false;
  return nowMs - firstSeenAtMs > ORPHAN_DATA_MIN_OBSERVED_MS;
}

/**
 * Split every uid that owns Firestore data into the three things a run does with
 * it, given which uids Auth CONFIRMED absent and what the watch collection
 * already remembers.
 *
 * One function rather than three loops in the handler for the reason
 * `withinOrphanCeiling` exists: the wiring is where a guard gets dropped without
 * failing a test. Production acts on exactly these three lists, so a bypass has
 * to change what it returns rather than delete an `if`.
 *
 * - `erase`      — confirmed absent AND first observed before the floor.
 * - `stamp`      — confirmed absent with NO readable observation yet. Recorded,
 *                  not deleted.
 * - `clearWatch` — has a watch record but reads PRESENT now. The account came
 *                  back, or the earlier lookup was wrong; either way the record
 *                  is dropped rather than left to age into a deletion. This is
 *                  also what stops the watch collection growing forever.
 *
 * A uid absent with a record that is merely TOO YOUNG appears in NO list — it is
 * neither erased nor re-stamped. Re-stamping it would be the latch this whole
 * mechanism is meant to avoid: writing `firstSeenAt = now` on every run moves
 * the deadline forward exactly as fast as the clock, so the floor could never
 * elapse and nothing would ever be erased. The record written on the first
 * observation is the one that must survive untouched until it is old enough.
 *
 * A uid that is neither absent nor watched appears in no list at all — the
 * overwhelming majority, and the run must not touch them.
 */
export function partitionOrphanData(
  uids: readonly string[],
  authAbsent: ReadonlySet<string>,
  firstSeenAt: ReadonlyMap<string, number | null>,
  nowMs: number,
): { erase: string[]; stamp: string[]; clearWatch: string[] } {
  const erase: string[] = [];
  const stamp: string[] = [];
  const clearWatch: string[] = [];
  for (const uid of uids) {
    if (!authAbsent.has(uid)) {
      if (firstSeenAt.has(uid)) clearWatch.push(uid);
      continue;
    }
    const seen = firstSeenAt.get(uid) ?? null;
    if (isObservedLongEnough(seen, nowMs)) erase.push(uid);
    // Only a uid with NOTHING readable on record is stamped. `seen === null`
    // covers both "no record" and "a record whose firstSeenAt is unusable" —
    // the latter is re-stamped because an unreadable clock must restart, not
    // count as elapsed.
    else if (seen === null) stamp.push(uid);
  }
  return { erase, stamp, clearWatch };
}
