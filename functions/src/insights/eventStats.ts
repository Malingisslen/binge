/**
 * Läser eventStats-dagdokumenten som recordEvent skriver (BIN-1438) och summerar dem över
 * intervallet, som askbinge.ts gör för askBingeStats. Den rena summeringen ligger i
 * eventStatsSummary.ts.
 *
 * `failed` skiljer ett läsfel (Insikter visar då "delvis data") från ett intervall där
 * ingenting mättes (`events: null`, inget fel).
 */

import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { EventsData, RangeInfo } from './types';
import { summarizeEventStats, type EventStatsDoc } from './eventStatsSummary';

export interface EventStatsRead {
  events: EventsData | null;
  eventsSince: string | null;
  failed: boolean;
}

export async function readEventStats(range: RangeInfo): Promise<EventStatsRead> {
  const col = getFirestore().collection('eventStats');
  try {
    const [inRange, first] = await Promise.all([
      col
        .where(FieldPath.documentId(), '>=', range.from)
        .where(FieldPath.documentId(), '<=', range.to)
        .get(),
      // Första räknade dagen över huvud taget — ett dokument, så Insikter kan skriva
      // "mäts sedan …" när intervallet börjar före den.
      col.orderBy(FieldPath.documentId(), 'asc').limit(1).get(),
    ]);
    const docs: EventStatsDoc[] = inRange.docs.map((d) => ({ id: d.id, data: d.data() }));
    return {
      events: summarizeEventStats(docs),
      eventsSince: first.empty ? null : first.docs[0].id,
      failed: false,
    };
  } catch (err) {
    logger.error('readEventStats failed', err);
    return { events: null, eventsSince: null, failed: true };
  }
}
