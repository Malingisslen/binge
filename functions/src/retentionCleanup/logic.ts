/**
 * Pure retention predicates for the daily cleanup sweep (BIN-65) — no
 * firebase-admin imports so they unit-test under the root vitest toolchain
 * (same split as reclaimOrphanFollows/logic.ts and episodeNotify/logic.ts).
 *
 * Thresholds come from docs/data-retention-policy.md §"Retention-policy för
 * icke-raderad data": Tillsammans-sessioner after 30 days, notifications after
 * 90 days.
 */

/** Legacy sessions without an `expiresAt` are reaped once older than this. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Notifications are reaped once older than this. */
export const NOTIFICATION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/**
 * joinAttempts (BIN-329) are reaped once older than this — 1 hour. A token-join
 * is a single synchronous two-step flow (write `joinAttempts/{uid}` with the
 * plaintext token, then immediately update the group); a successful join deletes
 * its own attempt within seconds (groups.ts), and a retry rewrites a fresh one.
 * So ANY attempt older than an hour is an abandoned/failed-cleanup orphan whose
 * only content is a now-spent plaintext invite token. Sweeping them is the
 * permanent backstop that closes the Art. 17 gap regardless of how the account
 * was deleted (self-service cascade, abandoned join, or Firebase Console — which
 * runs no client cascade). 1h is orders of magnitude beyond any legitimate
 * two-step window, so this can never reap an in-flight join.
 */
export const JOIN_ATTEMPT_MAX_AGE_MS = 60 * 60 * 1000;
/**
 * Release-notify per-user dedup markers (BIN-464:
 * `releaseNotifyState/{tmdbId}/notified/{uid}`) are reaped once older than this —
 * 30 days. The marker's ONLY job is to stop a second "släpps idag" push to the
 * same user for the same digital-release date; that job is finished once the
 * catch-up fire window (`RELEASE_CATCHUP_GRACE_DAYS` = 3 days after the release
 * date) has closed, since `releaseDateToFire` can never return that past date
 * again. 30 days is generous headroom over that 3-day window (so a still-useful
 * marker is never reaped) while bounding growth and — crucially — erasing this
 * uid-identifying behavioral data (which movie a user tracked / was notified
 * about, and when). The collection is admin-SDK-only (no `firestore.rules` match
 * → clients are default-denied), so the client account-deletion cascade cannot
 * reach it; this sweep is the SOLE Art. 17 erasure path, exactly like the
 * `joinAttempts` backstop, and covers self-service, abandoned and Console-deleted
 * accounts alike. Keyed on `updatedAt` (stamped every write, always >= the
 * release date), so a re-armed marker for a newer date resets its own clock.
 */
export const RELEASE_MARKER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Normalize a Firestore Timestamp field to epoch ms. Duck-typed on `toMillis()`
 * so this stays free of firebase-admin imports and is unit-testable; the Admin
 * SDK only ever returns a real Timestamp instance (with `toMillis`) for a
 * timestamp field, since Firestore cannot store a function on any other shape.
 * Anything else — missing field, a number, a string, undefined — yields null.
 */
export function tsToMillis(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const toMillis = (raw as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return null;
  const ms = (toMillis as () => unknown).call(raw);
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

/**
 * A Tillsammans session is reapable when its own `expiresAt` has passed, or —
 * for legacy sessions written before `expiresAt` existed — when it is older
 * than SESSION_MAX_AGE_MS. A session with neither timestamp is NEVER reaped
 * (conservative: never delete data we can't date).
 */
export function isExpiredSession(
  expiresAtMs: number | null,
  createdAtMs: number | null,
  nowMs: number,
): boolean {
  if (expiresAtMs !== null) return expiresAtMs < nowMs;
  if (createdAtMs !== null) return createdAtMs < nowMs - SESSION_MAX_AGE_MS;
  return false;
}

/**
 * A notification is reapable once older than NOTIFICATION_MAX_AGE_MS. An
 * undateable notification (no `createdAt`) is kept — same conservative stance.
 */
export function isStaleNotification(createdAtMs: number | null, nowMs: number): boolean {
  return createdAtMs !== null && createdAtMs < nowMs - NOTIFICATION_MAX_AGE_MS;
}

/**
 * A joinAttempt is reapable once older than JOIN_ATTEMPT_MAX_AGE_MS. An
 * undateable attempt (no `createdAt`) is kept — same conservative stance as the
 * other predicates (never delete data we can't date; the create rule always
 * stamps `createdAt`, so an undateable doc would be anomalous).
 */
export function isStaleJoinAttempt(createdAtMs: number | null, nowMs: number): boolean {
  return createdAtMs !== null && createdAtMs < nowMs - JOIN_ATTEMPT_MAX_AGE_MS;
}

/**
 * A release-notify dedup marker (BIN-464) is reapable once its `updatedAt` is
 * older than RELEASE_MARKER_MAX_AGE_MS. An undateable marker (no `updatedAt`) is
 * kept — same conservative stance as the other predicates (never delete data we
 * can't date; every write stamps `updatedAt`, so an undateable doc is anomalous).
 */
export function isStaleReleaseMarker(updatedAtMs: number | null, nowMs: number): boolean {
  return updatedAtMs !== null && updatedAtMs < nowMs - RELEASE_MARKER_MAX_AGE_MS;
}

/**
 * Admin SDK cap for `getUsers()` — 100 identifiers per call. Exported so the
 * batching and its test agree on one number.
 */
export const GET_USERS_BATCH = 100;

/** Split uids into ≤GET_USERS_BATCH chunks. Pure, so the cap can be tested. */
export function chunkUids(uids: string[], size: number = GET_USERS_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < uids.length; i += size) out.push(uids.slice(i, i + size));
  return out;
}

/**
 * BIN-848 — which uids in ONE `getUsers()` response have lost the right to be
 * pushed to.
 *
 * Two buckets qualify, and the distinction between them and everyone else is the
 * whole point:
 *  • `notFound` — no Auth user with that uid. Safe to read as deleted: an
 *    fcmTokens doc is only ever written for a real signed-in uid.
 *  • `disabled: true` — the account exists but is barred. Malin named a suspended
 *    account as a case she wants covered.
 *
 * `disabled` accounts ARE returned in `users`, so absence from `users` must NEVER
 * be the deleted signal — read `notFound` explicitly. Inferring it from absence
 * would turn any response-shape surprise into a silent over-delete, and this is
 * the only sweep in this function whose false positive destroys something a LIVE
 * account is using.
 */
export function revokedUidsFromLookup(result: {
  users: readonly { uid: string; disabled?: boolean }[];
  // The SDK types this as UserIdentifier[] — a union that also covers email,
  // phone and provider lookups. We only ever ask by uid, so anything without a
  // string `uid` is unexpected and is skipped rather than guessed at.
  notFound: readonly object[];
}): string[] {
  const out: string[] = [];
  for (const id of result.notFound) {
    const uid = (id as { uid?: unknown }).uid;
    if (typeof uid === 'string' && uid.length > 0) out.push(uid);
  }
  for (const u of result.users) if (u.disabled === true) out.push(u.uid);
  return out;
}

/** What one `getUsers()` call returns, narrowed to the two fields we read. */
export type UserLookupResult = Parameters<typeof revokedUidsFromLookup>[0];

/**
 * BIN-848 — run every uid through `lookup` in ≤GET_USERS_BATCH batches and
 * return the revoked ones, plus how many batches could not be checked.
 *
 * `lookup` is injected so this — the part that decides what a FAILED batch
 * means — is testable without Admin Auth. That matters more than it looks: a
 * batch that throws must skip ONLY itself, never abort the remaining batches
 * and never contribute uids. "Could not verify" is not "gone", and this sweep
 * deletes the push registration of whoever it names.
 *
 * `skippedBatches` is returned rather than merely logged so the run's own
 * summary can distinguish "nobody was revoked" from "Auth was down and we
 * checked nothing" — otherwise a total outage reads as a clean run.
 *
 * BIN-875 added `extract`. The batching, the skip-only-itself rule and the
 * best-effort reporting are what is worth having in ONE tested place; which
 * uids a response yields is not. The username sweep needs "absent from Auth"
 * (`orphans.ts`'s `absentUidsFromLookup`), which is deliberately narrower than
 * the default — a DISABLED account still exists and still owns its handle, so
 * releasing it would hand a suspended person's identity to the next claimant.
 * The name and the `revoked` field are kept as they were rather than churned
 * across the BIN-848 caller and its tests; read them as "the uids this lookup
 * selected".
 */
export async function revokedUidsInBatches(
  uids: string[],
  lookup: (batch: string[]) => Promise<UserLookupResult>,
  onBatchError?: (err: unknown, size: number) => void,
  extract: (result: UserLookupResult) => string[] = revokedUidsFromLookup,
): Promise<{ revoked: string[]; skippedBatches: number }> {
  const revoked: string[] = [];
  let skippedBatches = 0;
  for (const batch of chunkUids(uids)) {
    try {
      revoked.push(...extract(await lookup(batch)));
    } catch (err) {
      skippedBatches += 1;
      // The reporting callback is wrapped too: a logger that throws must not be
      // able to abort the remaining batches AND discard the uids already
      // revoked by earlier ones. "Skips only itself" has to hold for every way
      // a batch can fail, not just the expected one.
      try {
        onBatchError?.(err, batch.length);
      } catch {
        /* reporting is best-effort */
      }
    }
  }
  return { revoked, skippedBatches };
}
