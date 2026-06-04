'use client';

import type { MetricKey } from '../metrics/types';
import { DATA_RESOLVERS } from '../metrics/resolvers';
import { METRICS } from '../metrics/catalog';
import { useInsightsContext } from '../state/InsightsContext';

/** Lightweight inline-SVG line chart for a series metric (no chart library). */
export function TimeSeriesChart({ metricKey }: { metricKey: MetricKey }) {
  const data = useInsightsContext();
  const value = DATA_RESOLVERS[metricKey](data);
  const label = METRICS[metricKey].label;

  const points = value.kind === 'series' ? value.points : [];
  const W = 600; const H = 120; const PAD = 4;

  const ys = points.map((p) => p.y);
  const minY = points.length ? Math.min(...ys, 0) : 0;
  const maxY = points.length ? Math.max(...ys, 1) : 1;
  const rangeY = maxY - minY || 1;

  const coords = points.map((p, i) => {
    const x = points.length <= 1 ? W / 2 : PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((p.y - minY) / rangeY) * (H - PAD * 2);
    return { x, y };
  });
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

  const total = ys.reduce((a, b) => a + b, 0);

  return (
    <div className="bg-surface border border-rule rounded-md p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-3">{label}</span>
        <span className="text-sm text-ink-2 tabular-nums">{total.toLocaleString('sv-SE')} totalt</span>
      </div>
      {points.length === 0 ? (
        <div className="text-sm text-ink-3 py-2">Ingen data</div>
      ) : (
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className="text-acc block">
          <path d={path} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {coords.length === 1 && <circle cx={coords[0].x} cy={coords[0].y} r={3} fill="currentColor" />}
        </svg>
      )}
    </div>
  );
}
