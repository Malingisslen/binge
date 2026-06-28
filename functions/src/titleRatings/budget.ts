// Pure decision logic for the OMDb daily-budget reservation (BIN-346).
//
// Extracted from index.ts so the threshold/alert transitions can be unit-tested
// without Firestore. The onCall transaction reads the omdbBudget/{today} doc,
// calls evaluateOmdbBudget, persists the returned flags, and fires the alert /
// forensic log AFTER the transaction commits.

export interface OmdbBudgetState {
  /** Calls already reserved today, BEFORE this call. */
  count: number;
  /** Has the approaching-cap admin alert already fired today? */
  alerted: boolean;
  /** Has the hard-cap forensic error already been logged today? */
  capLogged: boolean;
}

export interface OmdbBudgetDecision {
  /** May this call spend an OMDb slot? */
  allowed: boolean;
  /** Count to persist (== state.count when !allowed — no slot spent). */
  newCount: number;
  /** Emit the once-per-day "approaching the cap" admin alert now. */
  fireAlert: boolean;
  /** Persist the `alerted` flag (so the alert fires at most once/day). */
  setAlerted: boolean;
  /** Emit the once-per-day hard-cap forensic error now. */
  fireCapLog: boolean;
  /** Persist the `capLogged` flag (so the error logs at most once/day). */
  setCapLogged: boolean;
}

/**
 * Decide whether a call may spend an OMDb slot, and whether to fire the
 * approaching-cap alert (at `alertThreshold`) or the hard-cap forensic log
 * (at `cap`). Both signals fire at most ONCE per day — the caller persists the
 * returned `set*` flags on the per-day budget doc in the same transaction, so a
 * busy day can't spam the admin inbox / logs.
 */
export function evaluateOmdbBudget(
  state: OmdbBudgetState,
  cap: number,
  alertThreshold: number,
): OmdbBudgetDecision {
  if (state.count >= cap) {
    const fireCapLog = !state.capLogged;
    return {
      allowed: false,
      newCount: state.count,
      fireAlert: false,
      setAlerted: false,
      fireCapLog,
      setCapLogged: fireCapLog,
    };
  }
  const newCount = state.count + 1;
  const fireAlert = newCount >= alertThreshold && !state.alerted;
  return {
    allowed: true,
    newCount,
    fireAlert,
    setAlerted: fireAlert,
    fireCapLog: false,
    setCapLogged: false,
  };
}
