// BIN-541 code-review fixes (2026-07-17): shared MOTN-budget I/O helpers
// (vendor-slot reservation, admin alerts, throttle confirmation), extracted
// from near-verbatim duplicates that had already drifted once between
// functions/src/streamingOffers/index.ts and functions/src/leavingRollup/index.ts.
// Lives outside budget.ts because it touches firebase-admin (budget.ts is
// deliberately admin-free so its pure decisions stay testable under the root
// vitest toolchain without a firebase-admin dependency — see the "Functions
// test import gotcha" note). The pure decision logic (reserveSlot,
// computeNotifyOnceFields, reserveThrottleSignal) lives in
// ../streamingOffers/budget.ts; this file is the thin I/O wrapper.
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { reserveSlot, computeNotifyOnceFields, computeClaimReleaseFields, reserveThrottleSignal, type ThrottleObservation } from '../streamingOffers/budget';

/**
 * Reserve one MOTN vendor-quota slot against a cycle-keyed budget doc.
 * Fresh-reads the current count INSIDE a Firestore transaction so concurrent
 * invocations (Cloud Scheduler's at-least-once, or streamingOffers' own
 * per-title loop calling this repeatedly) never overshoot `cap` between them
 * — the same reservation pattern both MOTN-calling jobs need, extracted here
 * (code review, 2026-07-17, round 4) after it had drifted into two
 * near-identical inline copies.
 */
export async function reserveMotnSlot(budgetRef: FirebaseFirestore.DocumentReference, cap: number): Promise<boolean> {
  return budgetRef.firestore.runTransaction(async (tx) => {
    const used = ((await tx.get(budgetRef)).get('count') as number | undefined) ?? 0;
    const d = reserveSlot(used, cap);
    if (d.granted) tx.set(budgetRef, { count: d.next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return d.granted;
  });
}

/**
 * Write a system notification into the admin's inbox (users/{ADMIN_UID}/notifications).
 * Returns whether it actually sent — false (no-op) if ADMIN_UID isn't bound.
 */
export async function sendAdminSystemNotification(title: string, body: string): Promise<boolean> {
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) return false;
  const db = getFirestore();
  await db.collection('users').doc(adminUid).collection('notifications').add({
    kind: 'system',
    title,
    body,
    actionUrl: '/insikter',
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  return true;
}

/**
 * Fire `notify` at most once per cycle, deduped via a `staleNotified` flag on
 * the caller's own cycle-keyed budget doc (a fresh doc per cycle means a new
 * cycle always starts unnotified).
 *
 * Code review (2026-07-17), round 3: a prior version took `alreadyNotified`
 * as a plain boolean READ BY THE CALLER earlier in the run, then wrote later
 * — a classic check-then-act race under Cloud Scheduler's at-least-once
 * delivery (two overlapping invocations can both read `false` before either
 * commits `true`, and both send the alert). The check-and-claim is now a
 * single Firestore TRANSACTION (the same pattern `reserveSlot`'s callers
 * already use to reserve a vendor-quota slot): only the invocation that wins
 * the transaction ever calls `notify()`. If `notify()` then reports it didn't
 * actually send (e.g. ADMIN_UID unbound), the claim is released so a future
 * run gets another chance instead of the alert being permanently swallowed.
 *
 * `extraFields` (e.g. burning the budget count to its cap) are written on
 * EVERY call regardless of whether this invocation wins the notify claim —
 * those are budget-state changes, not notification state, and must never be
 * skipped just because the alert already fired earlier in the cycle.
 */
export async function notifyOnceForCycle(
  budgetRef: FirebaseFirestore.DocumentReference,
  notify: () => Promise<boolean>,
  extraFields: Record<string, unknown> = {},
): Promise<void> {
  const claimed = await budgetRef.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(budgetRef);
    const alreadyNotified = (snap.get('staleNotified') as boolean | undefined) ?? false;
    // notifySent: !alreadyNotified — an OPTIMISTIC claim (we're about to attempt
    // notify(), not a report that it already succeeded). If it turns out to
    // fail, the caller releases the claim below (sets staleNotified back to
    // false) rather than leaving a false "sent" outcome persisted.
    const fields = computeNotifyOnceFields({ alreadyNotified, notifySent: !alreadyNotified, extraFields });
    tx.set(budgetRef, { ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return !alreadyNotified;
  });
  if (!claimed) return;

  // Security review (2026-07-17), round 4: if the Cloud Function is hard-killed
  // (GCP force-kill on the 300s timeout, no catch/finally runs) in the narrow
  // window between the claim above committing and the release write below,
  // `staleNotified` stays permanently true for the rest of the cycle — the
  // admin alert silently doesn't fire again even on genuine future exhaustion.
  // Accepted as a known residual: this is an admin-observability gap only
  // (no cost/cap impact — reserveSlot's reservation is untouched and still
  // correctly bounds vendor spend regardless), requires two changes together
  // to close properly (an idempotent, deterministic-doc-id notify() folded
  // into the SAME transaction as the claim — `.add()` inside a transaction
  // would itself risk duplicate sends on retry, which is why notify() stays
  // outside the transaction today), and the failure window is already the
  // rare intersection of "notify() fails" AND "hard-killed at that exact
  // moment." Not worth a fourth architectural pass for this diff.
  let sent = false;
  try {
    sent = await notify();
  } catch (err) {
    logger.warn('notifyOnceForCycle: notify() threw — budget state already persisted', err);
  }
  // We claimed the right to notify but it may not have actually sent —
  // computeClaimReleaseFields decides whether to release the claim (pure,
  // tested; see its doc comment) so a future run gets another chance instead
  // of this being permanently swallowed.
  const release = computeClaimReleaseFields(sent);
  if (release) {
    await budgetRef.set({ ...release, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

/**
 * Shared "did this run confirm vendor-quota exhaustion" step for both MOTN-
 * calling jobs (streamingOffers, leavingRollup): burns the cycle budget to
 * its cap and fires the once-per-cycle alert on confirmed exhaustion (2
 * consecutive 429s — see reserveThrottleSignal), otherwise just persists the
 * streak. Extracted (code review, 2026-07-17) after this exact block drifted
 * once already between the two call sites — the same drift risk
 * notifyOnceForCycle's own extraction was meant to close.
 *
 * Code review, round 4: `consecutive429Runs` is now READ FRESH inside a
 * transaction, not passed in from a value the caller captured at the top of
 * the run. A prior version took it as a plain parameter and wrote the streak
 * with a plain (non-transactional) `set()` — under two overlapping Scheduler
 * invocations, one could read a stale streak, wrongly conclude "2 consecutive
 * 429s" from what was actually only 1, and burn the WHOLE cycle budget to its
 * cap on a false positive — exactly the outage the 2-consecutive-run
 * confirmation design exists to prevent.
 */
export async function applyThrottleObservation(
  budgetRef: FirebaseFirestore.DocumentReference,
  observation: ThrottleObservation,
  cap: number,
  notify: () => Promise<boolean>,
  logContext: Record<string, unknown>,
): Promise<void> {
  const throttle = await budgetRef.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(budgetRef);
    const consecutive429Runs = (snap.get('consecutive429Runs') as number | undefined) ?? 0;
    const result = reserveThrottleSignal(observation, consecutive429Runs);
    // Only persist the streak here when NOT confirmed — the confirmed case
    // burns `count` to `cap` too, which notifyOnceForCycle's own transaction
    // handles together with the once-per-cycle notify claim (below).
    if (!result.confirmedExhausted && result.nextConsecutive !== consecutive429Runs) {
      tx.set(budgetRef, { consecutive429Runs: result.nextConsecutive, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    return result;
  });
  if (throttle.confirmedExhausted) {
    await notifyOnceForCycle(budgetRef, notify, { count: cap, consecutive429Runs: throttle.nextConsecutive });
    logger.warn('MOTN 429 confirmed across 2 runs — bucket burned for this cycle', logContext);
  }
}
