'use client';

import type { MetricKey } from '../metrics/types';
import { DATA_RESOLVERS } from '../metrics/resolvers';
import { METRICS } from '../metrics/catalog';
import { useInsightsContext } from '../state/InsightsContext';

// A small, fixed palette built from binge tokens — saffran accent first, then
// neutral inks. No foreign hues; stays within the design system.
const SLICE_CLASSES = ['text-acc', 'text-acc-deep', 'text-ink-2', 'text-ink-3', 'text-rule'];

function arc(cx: number, cy: number, r: number, start: number, end: number): string {
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Lightweight SVG donut for a breakdown metric (no chart library). */
export function Donut({ metricKey }: { metricKey: MetricKey }) {
  const data = useInsightsContext();
  const value = DATA_RESOLVERS[metricKey](data);
  const label = METRICS[metricKey].label;

  const entries = value.kind === 'breakdown' ? value.entries.filter((e) => e.value > 0) : [];
  const total = entries.reduce((s, e) => s + e.value, 0);

  const R = 42; const CX = 50; const CY = 50; const STROKE = 14;
  // Precompute each slice's [start,end] angle immutably (no reassigned render
  // variable — binge's react-compiler lint forbids that).
  const angles = entries.reduce<{ start: number; end: number }[]>((arr, e) => {
    const start = arr.length ? arr[arr.length - 1].end : -Math.PI / 2;
    const end = start + (total === 0 ? 0 : e.value / total) * Math.PI * 2;
    arr.push({ start, end });
    return arr;
  }, []);

  return (
    <div className="bg-surface border border-rule rounded-md p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-2">{label}</div>
      {total === 0 ? (
        <div className="text-sm text-ink-3 py-2">Ingen data</div>
      ) : (
        <div className="flex items-center gap-4">
          <svg width={104} height={104} viewBox="0 0 100 100" aria-hidden className="shrink-0">
            {entries.map((e, i) => {
              // Full-circle single slice: draw a ring instead of a degenerate arc.
              if (entries.length === 1) {
                return (
                  <circle key={e.label} cx={CX} cy={CY} r={R} fill="none" strokeWidth={STROKE}
                    className={SLICE_CLASSES[0]} stroke="currentColor" />
                );
              }
              const { start, end } = angles[i];
              return (
                <path key={e.label} d={arc(CX, CY, R, start, end)} fill="none" strokeWidth={STROKE}
                  className={SLICE_CLASSES[i % SLICE_CLASSES.length]} stroke="currentColor" strokeLinecap="butt" />
              );
            })}
          </svg>
          <ul className="flex flex-col gap-1 text-sm min-w-0">
            {entries.map((e, i) => (
              <li key={e.label} className="flex items-center gap-2 min-w-0">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${SLICE_CLASSES[i % SLICE_CLASSES.length]} bg-current shrink-0`} />
                <span className="truncate text-ink-2">{e.label}</span>
                <span className="ml-auto text-ink tabular-nums">{e.value.toLocaleString('sv-SE')}</span>
                <span className="text-ink-3 tabular-nums text-[11px] w-9 text-right">{Math.round((e.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
