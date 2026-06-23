/**
 * BIN-181 — realized-savings ledger rollup.
 *
 * The pause-history subcollection (users/{uid}/pauseHistory, written by resumeProvider)
 * records every completed pause with a `savedAmount` (round(cost * days / 30)). This
 * pure rollup turns that log into the advisor's ledger surface: "Du har sparat 2 094 kr
 * i år genom rotation", per-provider breakdown, and rotation count.
 *
 * Deterministic (injected `today`) so it unit-tests without a clock. Decoupled from the
 * hook: takes a minimal structural input rather than importing usePauseHistory.
 */

export interface LedgerInput {
  providerId: number;
  providerShortName: string;
  /** round(monthlyCost * durationDays / 30). */
  savedAmount: number;
  durationDays: number;
  /** ISO yyyy-mm-dd when the pause ended (used for the year-to-date slice). */
  resumedAt: string;
}

export interface ProviderSavings {
  providerId: number;
  shortName: string;
  saved: number;
  rotations: number;
}

export interface SavingsLedger {
  /** All-time total across every completed pause. */
  totalSaved: number;
  /** Saved in the calendar year of `today` ("i år"). */
  savedThisYear: number;
  /** Number of completed rotations (pause→resume cycles). */
  rotationCount: number;
  /** Longest single pause in days (for "din längsta paus"-stat). */
  longestPauseDays: number;
  /** Per-provider, sorted by saved desc then shortName. */
  byProvider: ProviderSavings[];
}

function yearOf(iso: string): number | null {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(iso);
  return m ? Number(m[1]) : null;
}

export function rollupSavingsLedger(
  entries: readonly LedgerInput[],
  opts: { today: Date },
): SavingsLedger {
  const currentYear = opts.today.getFullYear();

  let totalSaved = 0;
  let savedThisYear = 0;
  let longestPauseDays = 0;
  const byId = new Map<number, ProviderSavings>();

  for (const e of entries) {
    const saved = Number.isFinite(e.savedAmount) ? e.savedAmount : 0;
    totalSaved += saved;
    if (yearOf(e.resumedAt) === currentYear) savedThisYear += saved;
    if (Number.isFinite(e.durationDays) && e.durationDays > longestPauseDays) longestPauseDays = e.durationDays;

    const prev = byId.get(e.providerId);
    if (prev) {
      prev.saved += saved;
      prev.rotations += 1;
    } else {
      byId.set(e.providerId, {
        providerId: e.providerId,
        shortName: e.providerShortName,
        saved,
        rotations: 1,
      });
    }
  }

  const byProvider = [...byId.values()].sort((a, b) => {
    if (b.saved !== a.saved) return b.saved - a.saved;
    return a.shortName.localeCompare(b.shortName, 'sv');
  });

  return {
    totalSaved,
    savedThisYear,
    rotationCount: entries.length,
    longestPauseDays,
    byProvider,
  };
}
