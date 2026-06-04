'use client';

import type { KeyboardEvent } from 'react';
import type { MetricKey } from '../metrics/types';
import { METRICS } from '../metrics/catalog';
import { DATA_RESOLVERS } from '../metrics/resolvers';
import { useInsightsContext } from '../state/InsightsContext';
import { useSelectedMetric } from '../state/useSelectedMetric';
import { formatScalar } from './format';

/** Compact KPI tile. Click/Enter opens the ExplainDrawer for the metric. */
export function MetricTile({ metricKey }: { metricKey: MetricKey }) {
  const data = useInsightsContext();
  const [, setSelected] = useSelectedMetric();

  const def = METRICS[metricKey];
  const value = DATA_RESOLVERS[metricKey](data);

  const open = () => setSelected(metricKey);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };

  let display: string;
  let spark: { x: string; y: number }[] | null = null;

  if (value.kind === 'scalar') {
    display = formatScalar(value.value, def.format);
  } else if (value.kind === 'series') {
    spark = value.points;
    const last = value.points[value.points.length - 1];
    display = last ? formatScalar(last.y, def.format) : '–';
  } else if (value.kind === 'breakdown') {
    const top = value.entries.find((e) => e.value > 0) ?? value.entries[0];
    display = top ? `${top.label}: ${top.value.toLocaleString('sv-SE')}` : '–';
  } else {
    const first = value.steps[0];
    display = first ? first.count.toLocaleString('sv-SE') : '–';
  }

  let sparkEl: React.ReactNode = null;
  if (spark && spark.length >= 2) {
    const ys = spark.map((p) => p.y);
    const minY = Math.min(...ys);
    const rangeY = Math.max(...ys) - minY || 1;
    const W = 64; const H = 20;
    const pts = spark.map((p, i) => {
      const x = (i / (spark!.length - 1)) * W;
      const y = H - ((p.y - minY) / rangeY) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    sparkEl = (
      <svg className="mt-1 text-acc" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      className="bg-surface border border-rule rounded-sm px-3 py-2.5 cursor-pointer hover:shadow-lift transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-3">
        {def.label}
        {def.isNew && <span className="text-acc font-semibold">NY</span>}
      </div>
      <div className="text-[22px] leading-tight font-semibold text-ink tabular-nums mt-0.5">{display}</div>
      {sparkEl}
    </div>
  );
}
