// BIN-320 — pure decision for the MOTN quota counter.
//
// BIN-541 (2026-07-17): the "100-calls/day free tier" this was built against was
// never verified and turned out wrong — MOTN's real Basic plan is 500 requests
// per MONTH (checked on the RapidAPI dashboard), on a billing cycle anchored to
// the subscription's own start date (see `motnBillingCycleId` in ../util/dayId.ts),
// not a UTC-daily reset. The per-run batch is already capped, but a mid-run crash
// + Scheduler retry could re-spend and exceed the cycle cap. A persisted
// motnBudget/{cycleId} counter, reserved before each call, bounds the total across
// runs/retries within one billing cycle. This helper owns the reserve/deny
// decision (pure, testable); the transaction wrapper does the I/O.

export interface ReserveDecision {
  /** May this call spend a MOTN slot? */
  granted: boolean;
  /** Count to persist (== used when denied — no slot spent). */
  next: number;
}

/**
 * Reserve one slot against the daily cap. Denies (no increment) once `used`
 * reaches `cap`. Reservations are taken BEFORE the call and never refunded on
 * failure — RapidAPI counts the request, not the success (404/429/timeout all
 * burn a call), so the counter must assume every reserved slot = one real call.
 */
export function reserveSlot(used: number, cap: number): ReserveDecision {
  if (used >= cap) return { granted: false, next: used };
  return { granted: true, next: used + 1 };
}

export interface ThrottleSignal {
  /** Confirmed monthly exhaustion — safe to burn the bucket to the cap now. */
  confirmedExhausted: boolean;
  /** Count to persist for next run's `observation` check. */
  nextConsecutive: number;
}

/**
 * What a run actually learned about the vendor's quota, not just "did we see
 * a 429": `'clean'` means at least one call this run got a real non-429
 * response (proof the quota isn't gone); `'rate_limited'` means a 429;
 * `'no_signal'` means the run made no discriminating vendor call at all (e.g.
 * an empty batch, or every attempted call failed for an unrelated reason
 * like a network blip — neither proves nor disproves quota exhaustion).
 */
export type ThrottleObservation = 'clean' | 'rate_limited' | 'no_signal';

/**
 * BIN-541: a 429 from MOTN could mean the MONTHLY quota is truly gone, or a
 * transient trip of the vendor's separate 1000-req/hour rate limit (unlikely at
 * our volume, but not impossible — and burning the whole month's remaining
 * budget over an hourly blip would be a much worse outage than losing one run).
 * Require a 429 on two separate runs in a row before treating it as confirmed
 * exhaustion.
 *
 * Code review (2026-07-17): the first version of this reset the streak to 0 on
 * ANY non-429 run, including one with NO discriminating signal at all (empty
 * batch, or a budget-denial before any HTTP call was made) — that could erase
 * a legitimate in-progress 2-in-a-row confirmation for no real reason. Only a
 * `'clean'` run (genuine proof the vendor isn't rate-limiting) resets the
 * streak; `'no_signal'` leaves it untouched.
 */
export function reserveThrottleSignal(observation: ThrottleObservation, consecutive429Runs: number): ThrottleSignal {
  if (observation === 'no_signal') return { confirmedExhausted: false, nextConsecutive: consecutive429Runs };
  if (observation === 'clean') return { confirmedExhausted: false, nextConsecutive: 0 };
  const nextConsecutive = consecutive429Runs + 1;
  return { confirmedExhausted: nextConsecutive >= 2, nextConsecutive };
}

export interface NotifyOnceInput {
  /** Was the once-per-cycle alert already sent earlier in this cycle? */
  alreadyNotified: boolean;
  /** Did THIS call's notify callback report it actually sent (false if it no-op'd, e.g. missing ADMIN_UID)? Ignored when alreadyNotified is true. */
  notifySent: boolean;
  /** Budget-state fields (e.g. count/consecutive429Runs) that must persist regardless of notification outcome. */
  extraFields: Record<string, unknown>;
}

/**
 * BIN-541 code review (2026-07-17): the fields to persist for a once-per-cycle
 * admin alert (functions/src/util/notifyOnce.ts's I/O wrapper). Pure so the two
 * interactions a prior bug got wrong are directly testable without Firestore:
 * (1) `extraFields` (a budget-burn write) must survive even when the alert was
 * already sent earlier this cycle — those are two independent concerns, and
 * skipping the whole write when `alreadyNotified` is true previously dropped
 * critical budget state; (2) `staleNotified` is set ONLY when a fresh send this
 * call actually succeeded — never on `alreadyNotified`, and never on a `notify`
 * call that ran but reported it didn't send (e.g. ADMIN_UID unbound).
 */
export function computeNotifyOnceFields(input: NotifyOnceInput): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...input.extraFields };
  if (!input.alreadyNotified && input.notifySent) fields.staleNotified = true;
  return fields;
}

/**
 * Test review (2026-07-17): round 3's optimistic-claim-then-release redesign
 * (functions/src/util/notifyOnce.ts) added a SECOND decision — what to
 * persist once a claimed notify() turns out to have failed — that stayed as
 * an untested inline conditional. Extracted so it's directly testable: `null`
 * means "nothing to release" (the send succeeded, the claim stands); a
 * non-null result means "release the claim" (staleNotified back to false) so
 * a future run gets another chance instead of the alert being permanently
 * swallowed by a claim nobody ever fulfilled.
 */
export function computeClaimReleaseFields(notifySent: boolean): Record<string, unknown> | null {
  return notifySent ? null : { staleNotified: false };
}
