/**
 * Fråga Binge usage/error rollup — reads the daily counter docs written by the
 * recordAskBinge callable and aggregates them over the requested range.
 *
 * Unlike the current-state rollup (insights/daily), these are time-series: one
 * askBingeStats/{YYYY-MM-DD} doc accumulates that day's search outcomes. The API
 * sums the docs in [from, to] so the dashboard shows the period, not a snapshot.
 *
 * The pure aggregation lives in askbingeSummary.ts (unit-tested without
 * firebase-admin); this file is the thin Firestore-touching read.
 */

import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { AskBingeData, RangeInfo } from './types';
import { summarizeAskBinge, type AskBingeDoc } from './askbingeSummary';

/** Read askBingeStats/{date} docs in [from, to] (inclusive) and aggregate them. */
export async function readAskBingeStats(range: RangeInfo): Promise<AskBingeData | null> {
  try {
    // Date-string doc ids ("2026-05-03") sort below the live "daily" doc, so a
    // [from, to] documentId bound naturally excludes any non-dated doc.
    const snap = await getFirestore()
      .collection('askBingeStats')
      .where(FieldPath.documentId(), '>=', range.from)
      .where(FieldPath.documentId(), '<=', range.to)
      .get();
    return summarizeAskBinge(snap.docs.map((d) => d.data() as AskBingeDoc));
  } catch (err) {
    logger.error('readAskBingeStats failed', err);
    return null;
  }
}
