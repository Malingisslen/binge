'use client';

import { RangePicker } from './RangePicker';
import { useInsightsContext } from '../state/InsightsContext';

// The scheduled rollup recomputes the snapshot on this cadence — keep in sync
// with `every 6 hours` in functions/src/insights/rollup.ts.
const ROLLUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

function formatTime(d: Date): string {
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function formatStamp(d: Date): string {
  return d.toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Top toolbar: range picker + data-freshness line.
 *
 * We show when the underlying snapshot was *computed* (rollup.computedAt) plus
 * the next expected run, NOT just when the page last fetched — the numbers are a
 * snapshot up to 6h old, and a live "last fetched" stamp wrongly implies they're
 * current. Falls back to the fetch stamp only before any rollup exists.
 */
export function Toolbar({ lastFetchedAt }: { lastFetchedAt: Date | null }) {
  const data = useInsightsContext();
  const basis = data.window?.truncated ? data.window.basisDate : null;

  const computedAt = data.rollup?.computedAt ? new Date(data.rollup.computedAt) : null;
  const nextUpdate = computedAt ? new Date(computedAt.getTime() + ROLLUP_INTERVAL_MS) : null;
  // Compare against the fetch time (a prop) rather than reading the clock during
  // render — render must stay pure (react-hooks/purity). lastFetchedAt ≈ now.
  const nextLabel = nextUpdate && nextUpdate.getTime() > (lastFetchedAt?.getTime() ?? 0)
    ? `~${formatTime(nextUpdate)}`
    : 'inom kort';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <RangePicker />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
        {basis && <span>Periodsiffror jämförda mot {basis}</span>}
        {computedAt ? (
          <span>Data beräknad {formatStamp(computedAt)} · nästa uppdatering {nextLabel}</span>
        ) : (
          <span>Senast hämtad: {lastFetchedAt ? formatTime(lastFetchedAt) : '—'}</span>
        )}
      </div>
    </div>
  );
}
