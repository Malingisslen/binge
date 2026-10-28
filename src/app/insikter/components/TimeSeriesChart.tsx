'use client';

import type { MetricKey } from '../metrics/types';
import { DATA_RESOLVERS } from '../metrics/resolvers';
import { useInsightsContext } from '../state/InsightsContext';
import { CardHeader } from './CardHeader';
import { cardClass } from '@/components/ui/Card';

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Lightweight inline-SVG line chart for a series metric (no chart library). */
export function TimeSeriesChart({ metricKey }: { metricKey: MetricKey }) {
  const { data } = useInsightsContext();
  const value = DATA_RESOLVERS[metricKey](data);

  const points = value.kind === 'series' ? value.points : [];
  const W = 600; const H = 120; const PAD = 8;

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
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className={cardClass('p-3')}>
      <CardHeader metricKey={metricKey} className="mb-2" />
      {!value.missing && points.length > 0 && (
        <div className="text-sm text-ink-2 tabular-nums mb-1">{total.toLocaleString('sv-SE')} totalt</div>
      )}
      {points.length === 0 ? (
        <div className="text-sm text-ink-3 py-2">{value.missing ?? 'Ingen data'}</div>
      ) : (
        <>
          {/* No preserveAspectRatio="none": it would squash the point circles into ellipses. */}
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="text-acc block">
            <path d={path} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {coords.map((c, i) => (
              <g key={points[i].x}>
                <title>{`${formatDay(points[i].x)}: ${points[i].y.toLocaleString('sv-SE')}`}</title>
                {/* Wide transparent target so a 3-unit dot is still easy to hover. */}
                <circle cx={c.x} cy={c.y} r={10} fill="transparent" />
                <circle cx={c.x} cy={c.y} r={3} fill="currentColor" />
              </g>
            ))}
          </svg>
          <div className="flex justify-between text-xxs text-ink-3 tabular-nums mt-1">
            <span>{formatDay(first.x)}</span>
            {points.length > 1 && <span>{formatDay(last.x)}</span>}
          </div>
        </>
      )}
    </div>
  );
}
