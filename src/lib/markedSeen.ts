// BIN-1008 — one home for the OTHER of BIN-689's two rules: "is this title currently
// marked as seen", a membership test over status with no date requirement at all.
//
// It is deliberately NOT `seenDate` and must never be folded into it. `seenDate` answers
// "does this title have a countable seen date", which a title marked 'sedd' with a null
// `watchedAt` fails — and its callers count TITLES, so routing them through
// a date rule would silently drop exactly that title out of both "Sedd" tiles. That is
// #26 Information Architect's binding condition on BIN-689, restated here because this
// file is where a future reader is most likely to be tempted to "finish the migration".
//
// Extracted rather than left inline because prose is not a guard: BIN-1008 was filed
// because none of the three call sites had a test, so swapping one of them to a date
// check failed nothing. The rule now has one body and one suite.

import type { WatchStatus } from '@/types/domain';

/**
 * The titles currently marked as seen.
 *
 * Structurally typed on `status` ALONE — deliberately. The signature is what stops the
 * two rules from being collapsed: a function that cannot see `watchedAt` cannot start
 * depending on it, so #26's condition is enforced by the type rather than by a comment
 * someone has to read. Do not widen it to accept a date field.
 */
export function markedSeen<T extends { status: WatchStatus }>(items: readonly T[]): T[] {
  return items.filter(i => i.status === 'sedd');
}
