'use client';

import { RangePicker } from './RangePicker';
import { useInsightsContext } from '../state/InsightsContext';

function formatTime(d: Date): string {
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

/** Top toolbar: range picker + last-fetched timestamp + truncated-window note. */
export function Toolbar({ lastFetchedAt }: { lastFetchedAt: Date | null }) {
  const data = useInsightsContext();
  const basis = data.window?.truncated ? data.window.basisDate : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <RangePicker />
      <div className="flex items-center gap-3 text-[12px] text-ink-3">
        {basis && <span>Periodsiffror jämförda mot {basis}</span>}
        <span>Senast hämtad: {lastFetchedAt ? formatTime(lastFetchedAt) : '—'}</span>
      </div>
    </div>
  );
}
