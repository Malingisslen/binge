// Pure helpers for RecommendationsHub's cross-row dedup, extracted so the rule can
// be tested without mounting the hub (and with it React Query and Firebase) —
// the repo's standard test-extraction pattern, `.claude/rules/code-style.md`.
//
// The rule they encode (BIN-583, a binding condition of the #28 panel critique):
// a curated companion film is reachable from the same `mina`-TV seed pool as
// similar / latest-fav / upcoming, and `dedupeAndExclude` only dedupes WITHIN a
// row. So the page has to decide once, globally, which row owns the title —
// the companion row, because it is the row that explains why the film is there.
//
// BIN-809: this was wired inline in the hub and consumed in useRowCompanion, and
// neither had a test. `companionSeeds.test.ts` pinned only that the key list gets
// produced, not that anything applies it.

import { companionFilmKeys } from '@/lib/recommendations/companionSeeds';
import type { RowSpec, RowId } from '@/types';

/**
 * `excludedIds` ∪ every film the companion row will show this pass.
 *
 * Returns the ORIGINAL set unchanged when there are no companion films, so the
 * hub's memo keeps its identity and no row re-renders for nothing.
 */
export function excludedIdsForOtherRows(
  excludedIds: ReadonlySet<string>,
  rows: readonly RowSpec[],
): ReadonlySet<string> {
  const companionKeys = companionFilmKeys(
    rows.flatMap(r => (r.id.kind === 'companion' ? (r.meta?.companions ?? []) : [])),
  );
  if (companionKeys.size === 0) return excludedIds;
  const s = new Set(excludedIds);
  for (const k of companionKeys) s.add(k);
  return s;
}

/**
 * Which exclusion set a given row is handed. The companion row is the ONE row
 * that gets the base set, i.e. the one row allowed to render its own films.
 *
 * Deliberately keyed on the row KIND rather than on which row produced the keys:
 * `prioritizeRows` emits at most one companion row per pass, and keying on
 * identity would silently hand a second one the base set too — putting the same
 * film on the page twice, which is the thing this rule exists to prevent.
 */
export function exclusionsForRow(
  kind: RowId['kind'],
  excludedIds: ReadonlySet<string>,
  excludedIdsOtherRows: ReadonlySet<string>,
): ReadonlySet<string> {
  return kind === 'companion' ? excludedIds : excludedIdsOtherRows;
}
