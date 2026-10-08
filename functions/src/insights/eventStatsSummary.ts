/**
 * Ren summering av eventStats-dagdokument (BIN-1438) → EventsData.
 *
 * Fri från firebase-admin, som askbingeSummary.ts, så att rotens vitest kan testa den.
 * Läsningen mot Firestore ligger i eventStats.ts.
 *
 * Inga dokument → null, aldrig nollor: en dag utan dokument är en dag då ingenting mättes,
 * och Insikter visar den som "inte mätt".
 */

import type { EventsData } from './types';

export interface EventStatsDoc {
  id: string; // YYYY-MM-DD
  data: {
    counts?: Record<string, unknown>;
    props?: Record<string, unknown>;
  };
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function entriesOf(v: unknown): [string, unknown][] {
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v as Record<string, unknown>) : [];
}

export function summarizeEventStats(docs: EventStatsDoc[]): EventsData | null {
  if (docs.length === 0) return null;
  const counts: Record<string, number> = {};
  const props: EventsData['props'] = {};
  const daily: EventsData['daily'] = [];

  for (const doc of [...docs].sort((a, b) => a.id.localeCompare(b.id))) {
    const dayCounts: Record<string, number> = {};
    for (const [event, n] of entriesOf(doc.data.counts)) {
      if (!isCount(n)) continue;
      dayCounts[event] = n;
      counts[event] = (counts[event] ?? 0) + n;
    }
    daily.push({ date: doc.id, counts: dayCounts });

    for (const [event, byProp] of entriesOf(doc.data.props)) {
      for (const [prop, byValue] of entriesOf(byProp)) {
        for (const [value, n] of entriesOf(byValue)) {
          if (!isCount(n)) continue;
          const e = (props[event] ??= {});
          const p = (e[prop] ??= {});
          p[value] = (p[value] ?? 0) + n;
        }
      }
    }
  }
  return { counts, props, daily, days: docs.length };
}
