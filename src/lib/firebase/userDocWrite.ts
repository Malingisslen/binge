import { fsdb, type FirestoreKit } from './db';
import { isDeletionStarted } from '../deletionMarker';

/**
 * BIN-816 / ADR 0019 condition 1 — the ONE gate every write to `users/{uid}`
 * and `publicProfiles/{uid}` passes through.
 *
 * The ticket named two writers that can resurrect a deleted profile
 * (`markNotificationsSeen`, `updateUserField`). #27 Database and the Codebase
 * Archaeologist each counted seven in `AuthContext.tsx` alone —
 * `writeVisibilitySyncPending`, `updateProviderTier`, `resumeProvider`'s batch,
 * `updateDefaultVisibility`, `updateNotificationSettings`, plus the two named —
 * and an eighth in `OnboardingFlow.tsx`. `claimUsername` makes nine and the
 * public projection makes ten.
 *
 * So the panel's condition is explicitly NOT "patch the call sites": a
 * per-site fix reopens the hole the next time someone adds a write. Every
 * profile write goes through `mergeUserDoc`, the two that must build their own
 * batch call `assertProfileWritable` first, and
 * `userDocWrite.chokepoint.test.ts` fails the build if a new writer appears
 * outside this module.
 *
 * Note what this does NOT gate: `deleteAccount()` itself and its retry (ADR
 * 0019 condition 3). The cascade writes no profile document — it deletes one —
 * and the retry is the only recovery path that exists, so gating it would trap
 * exactly the user the marker is meant to help.
 */

/**
 * Thrown when a profile write is attempted for an account whose deletion has
 * started. Its own code so a caller can tell it from a permission error: this
 * one means "you asked for this", not "something is broken".
 */
export const DELETION_IN_PROGRESS = 'binge/deletion-in-progress';

/**
 * Refuse a profile write for an account mid-deletion.
 *
 * Exported for the two call sites that cannot use `mergeUserDoc` because they
 * write `users/{uid}` inside a larger atomic batch (`resumeProvider`'s
 * pause-history batch, `claimUsername`'s reservation batch). They call this
 * before building the batch, so the check is one implementation with two entry
 * points rather than two implementations.
 */
export function assertProfileWritable(uid: string): void {
  if (isDeletionStarted(uid)) {
    throw new Error(
      `${DELETION_IN_PROGRESS}: kontot håller på att raderas — profilen får inte skrivas om`,
    );
  }
}

/**
 * The sanctioned `setDoc(users/{uid}, …, { merge: true })`.
 *
 * `build` may be a plain payload, or a function handed the Firestore kit — the
 * latter for the callers that need a sentinel value (`serverTimestamp()`,
 * `deleteField()`) inside their payload. Without that form they would have to
 * import `fsdb` themselves, which is the shape the chokepoint test forbids.
 *
 * `updatedAt` is stamped here because every caller stamped it, and a writer
 * that forgot would be a silent drift rather than a compile error.
 */
export async function mergeUserDoc(
  uid: string,
  build: Record<string, unknown> | ((kit: FirestoreKit) => Record<string, unknown>),
): Promise<void> {
  assertProfileWritable(uid);
  const kit = await fsdb();
  const data = typeof build === 'function' ? build(kit) : build;
  await kit.setDoc(
    kit.doc(kit.db, 'users', uid),
    { ...data, updatedAt: kit.serverTimestamp() },
    { merge: true },
  );
}

/**
 * The sanctioned `setDoc(publicProfiles/{uid}, …, { merge: true })`.
 *
 * The public projection is the second resurrection path (BIN-816 AC2): the
 * cascade deletes `publicProfiles/{uid}`, and `syncMyPublicProfile`'s effect
 * would rebuild it from React state on the very next render. Unlike the profile
 * document this one is best-effort by design and never throws at its call site,
 * so the gate returns a boolean instead of throwing.
 *
 * Returns false when the write was refused because a deletion is in progress.
 */
export async function mergePublicProfileDoc(
  uid: string,
  build: (kit: FirestoreKit) => Record<string, unknown>,
): Promise<boolean> {
  if (isDeletionStarted(uid)) return false;
  const kit = await fsdb();
  await kit.setDoc(kit.doc(kit.db, 'publicProfiles', uid), build(kit), { merge: true });
  return true;
}
