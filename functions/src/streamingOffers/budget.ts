// BIN-320 — pure decision for the MOTN daily-quota counter.
//
// MOTN (Movie of the Night, via RapidAPI) has a 100-calls/day free tier. The
// per-run batch is already capped, but a mid-run crash + Scheduler retry could
// re-spend and exceed 100/day. A persisted motnBudget/{utcDay} counter, reserved
// before each call, bounds the total across runs/retries. This helper owns the
// reserve/deny decision (pure, testable); the transaction wrapper does the I/O.

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
