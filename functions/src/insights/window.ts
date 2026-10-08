/**
 * Pure period-metric math for Insikter. No firebase imports so it runs under the
 * root vitest toolchain (functions/ has no test runner of its own).
 *
 * The dashboard's period tiles ("Nya användare", "Titlar tillagda") are the net
 * change between today's rollup snapshot and a baseline snapshot from the start
 * of the selected window. Raw net is returned here (can be negative); the
 * frontend floors it at 0 for display under an "added"-style label.
 */
import type { RollupData, WindowDeltas } from './types';

export function computeWindowDeltas(
  daily: RollupData,
  baseline: RollupData | null,
  baselineDate: string | null,
  requestedFrom: string,
): WindowDeltas | null {
  if (!baseline || !baselineDate) return null;
  return {
    basisDate: baselineDate,
    truncated: baselineDate > requestedFrom,
    deltas: {
      users: daily.totals.users - baseline.totals.users,
      titlesTracked: daily.totals.titlesTracked - baseline.totals.titlesTracked,
    },
  };
}

/**
 * Which insights doc is the window's baseline: the newest `YYYY-MM-DD` snapshot on or
 * before `from`, else the oldest one (history doesn't reach `from`; the dashboard then
 * shows its "sedan {datum}" note). The live `daily` doc and any other non-date id never
 * qualify. Lexicographic compare is chronological for ISO dates.
 */
export function pickBaselineId(ids: readonly string[], from: string): string | null {
  const dated = ids.filter((id) => /^\d{4}-\d{2}-\d{2}$/.test(id)).sort();
  if (dated.length === 0) return null;
  const onOrBefore = dated.filter((id) => id <= from);
  return onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : dated[0];
}
