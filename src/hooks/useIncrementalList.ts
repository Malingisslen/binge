'use client';

import { useEffect, useState } from 'react';
import { useInView } from './useInView';

export function incrementalSlice<T>(items: T[], count: number): { visible: T[]; hasMore: boolean } {
  return { visible: items.slice(0, count), hasMore: count < items.length };
}

/**
 * Inkrementell rendering för långa listor utan extern beroende. Visar de första
 * `initial` posterna; när `sentinelRef`-elementet scrollas in (inom rootMargin)
 * höjs antalet med `step`. Nollställs till `initial` när `items`-referensen
 * ändras (filter/sortering) — så en sökning aldrig re-renderar mer än `initial`
 * noder. I jsdom/utan IntersectionObserver blir inView=true direkt → hela listan
 * visas (korrekt för tester; ingen windowing att verifiera där).
 */
export function useIncrementalList<T>(
  items: T[],
  opts?: { initial?: number; step?: number },
): { visible: T[]; hasMore: boolean; sentinelRef: (node: HTMLDivElement | null) => void } {
  const initial = opts?.initial ?? 100;
  const step = opts?.step ?? 60;
  const [count, setCount] = useState(initial);
  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>({ rootMargin: '600px' });

  // Nollställ när listan byter identitet (filter/sortering/statusbyte).
  useEffect(() => {
    setCount(initial);
  }, [items, initial]);

  // Avslöja fler medan sentineln syns och det finns mer kvar.
  useEffect(() => {
    if (inView && count < items.length) {
      setCount(c => Math.min(items.length, c + step));
    }
  }, [inView, count, items.length, step]);

  const { visible, hasMore } = incrementalSlice(items, count);
  return { visible, hasMore, sentinelRef };
}
