// BIN-93 (runtime axis) — runtime-budget lens for the Väljaren ("vad hinner jag
// på 90 min?"). Filters the user's own backlog by WatchlistItem.runtime (lazily
// backfilled from title-detail views). A runtime budget answers "do I have time
// for this?", so titles with UNKNOWN runtime are EXCLUDED when a budget is active
// — an unknown-length film can't honestly answer the question. (No budget → all.)

export const RUNTIME_BUDGETS = [30, 60, 90, 120] as const;
export type RuntimeBudget = (typeof RUNTIME_BUDGETS)[number];

export function runtimeBudgetLabel(max: number): string {
  return `≤ ${max} min`;
}

export function filterByRuntime<T extends { runtime?: number | null }>(
  items: T[],
  maxMinutes: number | null,
): T[] {
  if (maxMinutes == null) return items;
  return items.filter(i => i.runtime != null && i.runtime <= maxMinutes);
}
