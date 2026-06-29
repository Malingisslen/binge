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
