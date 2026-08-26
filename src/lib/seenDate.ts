// BIN-689 (BIN-598 part 2) — one home for "a watchedAt date only counts as a seen date
// when the item is currently marked 'sedd'".
//
// BIN-593 made watchedAt user-owned data that is NOT cleared when a title leaves 'sedd',
// so the raw field outlives the status. Every surface that shows or counts a seen date
// therefore has to re-apply the status gate. BIN-689 migrated these five hand-copies of
// it: the diary page, buildDiary, the library's Sedd column, the public profile's 30-day
// counter, and the stats page's monthly activity. Copies of one rule are places someone
// can forget it, and then the diary, the stats page and the public profile give different
// answers to the same question.
//
// That list is what MOVED, not a census of what reads the field. Other surfaces still gate
// inline — some because they count titles rather than dates, some simply because
// BIN-689 did not reach them. Do not read the five as "and no others"; derive it:
//   grep -rn "watchedAt" src/ --include=*.ts --include=*.tsx
//
// This is deliberately ONE of the two rules those surfaces use. The other — "is this item
// currently marked sedd", a membership test with no date requirement — lives in
// `src/lib/markedSeen.ts`.
// Routing those through here would silently drop a sedd item whose watchedAt is missing
// from the "Sedd" tiles on the stats page and the public profile. (#26 Information
// Architect's binding condition on this ticket, 2026-08-25.)

import type { WatchStatus } from '@/types/domain';

/**
 * The date this title was seen, or null when it does not currently count as seen.
 *
 * Structurally typed rather than taking a full WatchlistItem so it stays a pure helper
 * with no Firebase import — the test-extraction convention in .claude/rules/code-style.md.
 */
export function seenDate(item: { status: WatchStatus; watchedAt: Date | null }): Date | null {
  return item.status === 'sedd' ? item.watchedAt : null;
}
