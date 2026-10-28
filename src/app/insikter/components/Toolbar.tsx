'use client';

import { RangePicker } from './RangePicker';
import { useInsightsContext } from '../state/InsightsContext';

// The scheduled rollup recomputes the snapshot on this cadence — keep in sync
// with `every 24 hours` in functions/src/insights/rollup.ts.
const ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
// A run later than this is overdue, not merely "soon": the rollup has missed its slot.
const OVERDUE_AFTER_MS = 30 * 60 * 60 * 1000;

function formatTime(d: Date): string {
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function formatStamp(d: Date): string {
  return d.toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** When the next rollup is due, phrased against `now` (the fetch time, never the clock). */
function nextUpdateText(computedAt: Date, now: Date): string {
  const next = new Date(computedAt.getTime() + ROLLUP_INTERVAL_MS);
  if (next.getTime() > now.getTime()) {
    const day = next.toDateString() === now.toDateString() ? 'i dag' : 'imorgon';
    return `nästa uppdatering ungefär ${day} ${formatTime(next)}`;
  }
  return now.getTime() - computedAt.getTime() > OVERDUE_AFTER_MS
    ? 'uppdateringen är försenad'
    : 'nästa uppdatering väntas i dag';
}

/**
 * Top toolbar: range picker + data-freshness line.
 *
 * We show when the underlying snapshot was *computed* (rollup.computedAt) plus
 * the next expected run, NOT just when the page last fetched — the numbers are a
 * snapshot up to a day old, and a live "last fetched" stamp wrongly implies they're
 * current. Falls back to the fetch stamp only before any rollup exists.
 */
export function Toolbar({ lastFetchedAt }: { lastFetchedAt: Date | null }) {
  const { data } = useInsightsContext();
  const basis = data.window?.truncated ? data.window.basisDate : null;
  // Händelseräkningen (eventStats) började ett visst datum; ett intervall som börjar före
  // det får inte läsas som att ingenting hände dagarna innan.
  const eventsSince = data.eventsSince && data.eventsSince > data.range.from ? data.eventsSince : null;

  const computedAt = data.rollup?.computedAt ? new Date(data.rollup.computedAt) : null;
  // Compare against the fetch time (a prop) rather than reading the clock during
  // render — render must stay pure (react-hooks/purity). lastFetchedAt ≈ now.
  const now = lastFetchedAt ?? new Date(data.generatedAt);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <RangePicker />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
        {basis && <span>Periodsiffror jämförda mot {basis}</span>}
        {eventsSince && <span>Händelser mäts sedan {eventsSince}</span>}
        {!data.eventsSince && !data.partial && <span>Händelser har inte räknats än</span>}
        {computedAt ? (
          <span>{`Data beräknad ${formatStamp(computedAt)} · ${nextUpdateText(computedAt, now)}`}</span>
        ) : (
          <span>Senast hämtad: {lastFetchedAt ? formatTime(lastFetchedAt) : '—'}</span>
        )}
        <span>Dagens siffror fylls på till nästa beräkning</span>
      </div>
    </div>
  );
}
