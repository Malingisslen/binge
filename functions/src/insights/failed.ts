/**
 * Which sources of an /api/insights response could not be read. Pure, no
 * firebase import, so the root vitest toolchain tests it. The dashboard refuses
 * a tile's period comparison only on the tile's own source (BIN-1458), so the
 * list must name the source, not just that something failed.
 */
import type { InsightsSource } from './types';

export function failedSources(read: {
  rollup: { partial: boolean } | null;
  eventsFailed: boolean;
  history: unknown[] | null;
  traffic: object | null;
}): InsightsSource[] {
  const failed: InsightsSource[] = [];
  if (read.rollup === null || read.rollup.partial) failed.push('rollup');
  if (read.eventsFailed) failed.push('events');
  if (read.history === null) failed.push('history');
  if (read.traffic === null) failed.push('traffic');
  return failed;
}
