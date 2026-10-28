import type { MetricDef, MetricValue } from './types';
import type { InsightsData, RangeInfo } from '../insights.types';

/**
 * "Mot förra perioden" for a comparable period metric (#22's conditions, plan
 * 2026-10-28): the previous window must be fully measured, the comparison is an
 * absolute difference without a good/bad colour, and small bases show both
 * numbers instead of an arrow so 2→4 is not read as a trend.
 */

/** Below this previous value the tile shows both numbers, no arrow. */
export const SMALL_BASE = 10;

export type Comparison =
  | { kind: 'delta'; delta: number }
  | { kind: 'both'; current: number; previous: number }
  | { kind: 'unavailable'; reason: string };

/** Same number of days as `current`, ending the day before it starts. Presets only. */
export function previousRange(current: RangeInfo): RangeInfo | null {
  if (current.preset === 'custom') return null;
  const from = Date.parse(`${current.from}T00:00:00Z`);
  const to = Date.parse(`${current.to}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  const DAY = 86_400_000;
  const days = Math.round((to - from) / DAY) + 1;
  const prevTo = from - DAY;
  const prevFrom = prevTo - (days - 1) * DAY;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { preset: 'custom', from: iso(prevFrom), to: iso(prevTo) };
}

/**
 * Why the previous window cannot be compared, or null when it can. Event metrics
 * need the whole previous window on or after the first counted day. Rollup-window
 * metrics need an untruncated baseline for BOTH windows, and two different ones:
 * the server's deltas run from a window's start to today (computeWindowDeltas
 * ignores `to`), so the previous window's own growth is only measurable as the
 * difference between the two baselines.
 */
export function previousWindowProblem(def: MetricDef, current: InsightsData, previous: InsightsData | null): string | null {
  if (!previous) return 'ingen jämförelse: förra perioden kunde inte hämtas';
  if (previous.partial) return 'ingen jämförelse: förra perioden kunde inte hämtas helt';
  if (def.source === 'events') {
    if (!previous.events) return 'ingen jämförelse: förra perioden är inte räknad';
    if (previous.eventsSince && previous.range.from < previous.eventsSince) {
      return `ingen jämförelse: mätningen började ${previous.eventsSince}`;
    }
    return null;
  }
  if (!previous.window || !current.window) return 'ingen jämförelse: ingen historik för förra perioden';
  if (previous.window.truncated) return `ingen jämförelse: historiken börjar ${previous.window.basisDate}`;
  if (current.window.truncated) return `ingen jämförelse: historiken börjar ${current.window.basisDate}`;
  if (previous.window.basisDate >= current.window.basisDate) return 'ingen jämförelse: ingen beräkning mellan perioderna';
  return null;
}

/**
 * The previous window's own growth for a rollup metric: its start-to-today delta
 * minus the current window's, floored at 0 like the tile's own number.
 */
function previousWindowGrowth(field: NonNullable<MetricDef['windowField']>, current: InsightsData, previous: InsightsData): MetricValue {
  const cur = current.window; const prev = previous.window;
  if (!cur || !prev) return { kind: 'scalar', value: NaN };
  return { kind: 'scalar', value: Math.max(0, prev.deltas[field] - cur.deltas[field]) };
}

/**
 * `previous` undefined = not fetched yet (no line at all); null = the fetch failed.
 * A custom range has no "previous period", so no line either.
 */
export function compare(
  def: MetricDef,
  currentValue: MetricValue,
  previousValue: MetricValue,
  current: InsightsData,
  previous: InsightsData | null | undefined,
): Comparison | null {
  if (!def.comparable || def.snapshot) return null;
  if (current.range.preset === 'custom' || previous === undefined) return null;
  if (currentValue.kind !== 'scalar') return null;
  const problem = previousWindowProblem(def, current, previous);
  if (problem) return { kind: 'unavailable', reason: problem };
  const prevValue = def.windowField && previous ? previousWindowGrowth(def.windowField, current, previous) : previousValue;
  if (prevValue.kind !== 'scalar') return null;
  if (currentValue.missing || prevValue.missing) return { kind: 'unavailable', reason: 'ingen jämförelse: ett av värdena saknas' };
  if (!Number.isFinite(currentValue.value) || !Number.isFinite(prevValue.value)) {
    return { kind: 'unavailable', reason: 'ingen jämförelse: ett av värdena saknas' };
  }
  if (prevValue.value < SMALL_BASE) return { kind: 'both', current: currentValue.value, previous: prevValue.value };
  return { kind: 'delta', delta: currentValue.value - prevValue.value };
}
