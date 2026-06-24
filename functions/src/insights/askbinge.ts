/**
 * Fråga Binge usage/error rollup — reads the daily counter docs written by the
 * recordAskBinge callable and aggregates them over the requested range.
 *
 * Unlike the current-state rollup (insights/daily), these are time-series: one
 * askBingeStats/{YYYY-MM-DD} doc accumulates that day's search outcomes. The API
 * sums the docs in [from, to] so the dashboard shows the period, not a snapshot.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { AskBingeData, RangeInfo } from './types';

export interface AskBingeDoc {
  searches?: number;
  zeroResults?: number;
  lowConfidence?: number;
  chipRemovals?: number;
  resultBuckets?: Record<string, number>;
  filterCombos?: Record<string, { searches?: number; zero?: number }>;
  removedChips?: Record<string, number>;
}

const TOP_N = 10;
const BUCKET_KEYS = ['0', '1-9', '10-29', '30+'] as const;

export function summarizeAskBinge(docs: AskBingeDoc[]): AskBingeData {
  let searches = 0, zeroResults = 0, lowConfidence = 0, chipRemovals = 0;
  const resultBuckets: Record<string, number> = { '0': 0, '1-9': 0, '10-29': 0, '30+': 0 };
  const combos = new Map<string, { searches: number; zero: number }>();
  const chips = new Map<string, number>();

  for (const d of docs) {
    searches += d.searches ?? 0;
    zeroResults += d.zeroResults ?? 0;
    lowConfidence += d.lowConfidence ?? 0;
    chipRemovals += d.chipRemovals ?? 0;
    for (const k of BUCKET_KEYS) resultBuckets[k] += d.resultBuckets?.[k] ?? 0;
    for (const [combo, v] of Object.entries(d.filterCombos ?? {})) {
      const cur = combos.get(combo) ?? { searches: 0, zero: 0 };
      cur.searches += v.searches ?? 0;
      cur.zero += v.zero ?? 0;
      combos.set(combo, cur);
    }
    for (const [key, n] of Object.entries(d.removedChips ?? {})) {
      chips.set(key, (chips.get(key) ?? 0) + n);
    }
  }

  const topStrandingFilters = [...combos.entries()]
    .map(([filters, v]) => ({ filters, searches: v.searches, zero: v.zero }))
    .filter((c) => c.zero > 0)
    .sort((a, b) => b.zero - a.zero || b.searches - a.searches || a.filters.localeCompare(b.filters))
    .slice(0, TOP_N);

  const topRemovedChips = [...chips.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, TOP_N);

  return {
    searches, zeroResults, lowConfidence, chipRemovals,
    resultBuckets: {
      '0': resultBuckets['0'], '1-9': resultBuckets['1-9'],
      '10-29': resultBuckets['10-29'], '30+': resultBuckets['30+'],
    },
    topStrandingFilters,
    topRemovedChips,
    days: docs.length,
  };
}

/** Read askBingeStats/{date} docs in [from, to] (inclusive) and aggregate them. */
export async function readAskBingeStats(range: RangeInfo): Promise<AskBingeData | null> {
  try {
    const snap = await getFirestore()
      .collection('askBingeStats')
      .where('__name__', '>=', `askBingeStats/${range.from}`)
      .where('__name__', '<=', `askBingeStats/${range.to}`)
      .get();
    return summarizeAskBinge(snap.docs.map((d) => d.data() as AskBingeDoc));
  } catch (err) {
    logger.error('readAskBingeStats failed', err);
    return null;
  }
}
