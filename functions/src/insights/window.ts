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
