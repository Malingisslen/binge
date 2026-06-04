'use client';

import { RangePicker } from './RangePicker';

function formatTime(d: Date): string {
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

/** Top toolbar: range picker + last-fetched timestamp. */
export function Toolbar({ lastFetchedAt }: { lastFetchedAt: Date | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <RangePicker />
      <span className="text-[12px] text-ink-3">
        Senast hämtad: {lastFetchedAt ? formatTime(lastFetchedAt) : '—'}
      </span>
    </div>
  );
}
