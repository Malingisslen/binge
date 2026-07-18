// BIN-543 — leavingRollup's cadence + cycle-cap constants, split out of index.ts
// specifically so motnChanges.test.ts can import the REAL values instead of
// hand-duplicating them (test review, 2026-07-18: a hardcoded copy silently
// stopped catching a cadence/cap regression, only still catching a MAX_PAGES
// regression — same "Functions test import gotcha" class as the file-level
// admin-free split, just at the constant level). Admin-free so the root
// vitest toolchain can import it; index.ts still owns the actual onSchedule
// wiring.

/** MOTN vendor-quota cycle budget for this job (its slice of BIN-541's combined ~450-of-500 safe pool). */
export const LEAVING_HARD_CYCLE_CAP = 150;

/** Cloud Scheduler cadence, in hours — see index.ts's onSchedule for the arithmetic proof against LEAVING_HARD_CYCLE_CAP. */
export const CADENCE_HOURS = 96;
