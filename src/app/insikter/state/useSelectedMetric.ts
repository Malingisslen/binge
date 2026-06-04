'use client';
import { useState, useEffect, useCallback } from 'react';
import type { MetricKey } from '../metrics/types';

/** Reads/writes the ?metric=<key> URL param that drives the ExplainDrawer. */
function read(): MetricKey | null {
  if (typeof window === 'undefined') return null;
  return (new URLSearchParams(window.location.search).get('metric') as MetricKey) || null;
}

export function useSelectedMetric(): [MetricKey | null, (key: MetricKey | null) => void] {
  const [selected, setSelected] = useState<MetricKey | null>(read);
  useEffect(() => {
    const onPop = () => setSelected(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const update = useCallback((key: MetricKey | null) => {
    const p = new URLSearchParams(window.location.search);
    if (key) p.set('metric', key);
    else p.delete('metric');
    window.history.pushState({}, '', `${window.location.pathname}?${p}`);
    setSelected(key);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  return [selected, update];
}
