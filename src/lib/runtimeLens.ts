// BIN-93 (runtime axis) — runtime-budget lens for the Väljaren ("vad hinner jag
// på 90 min?"). Filters the user's own backlog by WatchlistItem.runtime (lazily
// backfilled from title-detail views).
//
// BIN-167: a budget HIDES titles whose KNOWN runtime exceeds it (they genuinely
// don't fit), but KEEPS titles with UNKNOWN runtime — surfaced DIMMED instead of
// dropped. Hiding unknowns made the picker look emptier than the library is and
// silently buried good picks on missing metadata. Dimming lets the user decide
// while the list still leads with the confident, within-budget picks.

export const RUNTIME_BUDGETS = [30, 60, 90, 120] as const;
export type RuntimeBudget = (typeof RUNTIME_BUDGETS)[number];

export function runtimeBudgetLabel(max: number): string {
  return `≤ ${max} min`;
}

export interface RuntimeLensResult<T> {
  item: T;
  /** True when a budget is active and the title has no known runtime → shown dimmed. */
  unknownRuntime: boolean;
}

/**
 * Apply the runtime budget. With no budget every item passes (never dimmed).
 * With a budget active, keep titles whose runtime is ≤ budget (boundary
 * inclusive) AND titles with unknown runtime (flagged `unknownRuntime` so the
 * caller can dim them); drop only the titles known to be over budget.
 */
export function applyRuntimeBudget<T extends { runtime?: number | null }>(
  items: T[],
  maxMinutes: number | null,
): RuntimeLensResult<T>[] {
  if (maxMinutes == null) return items.map(item => ({ item, unknownRuntime: false }));
  return items
    .filter(i => i.runtime == null || i.runtime <= maxMinutes)
    .map(item => ({ item, unknownRuntime: item.runtime == null }));
}
