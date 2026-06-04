'use client';
import { useState, useEffect, useCallback } from 'react';

export interface DateRange { preset: '24h' | '7d' | '30d' | '90d' | 'custom'; from: string; to: string; }

function read(): DateRange {
  if (typeof window === 'undefined') return { preset: '30d', from: '', to: '' };
  const p = new URLSearchParams(window.location.search);
  const preset = (p.get('range') as DateRange['preset']) || '30d';
  return { preset, from: p.get('from') || '', to: p.get('to') || '' };
}

export function useDateRange(): [DateRange, (next: DateRange) => void] {
  const [range, setRange] = useState<DateRange>(read);
  useEffect(() => {
    const onPop = () => setRange(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const update = useCallback((next: DateRange) => {
    const p = new URLSearchParams(window.location.search);
    p.set('range', next.preset);
    if (next.preset === 'custom') { p.set('from', next.from); p.set('to', next.to); }
    else { p.delete('from'); p.delete('to'); }
    window.history.pushState({}, '', `${window.location.pathname}?${p}`);
    setRange(next);
    // pushState does not fire popstate; synthesize one so the data-fetching
    // hook instance re-reads the URL and refetches.
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  return [range, update];
}
