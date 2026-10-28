'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import type { MetricDef, MetricKey, MetricValue } from '../metrics/types';
import { METRICS } from '../metrics/catalog';
import { DATA_RESOLVERS } from '../metrics/resolvers';
import { compare, type Comparison } from '../metrics/comparison';
import { useInsightsContext } from '../state/InsightsContext';
import { useSelectedMetric } from '../state/useSelectedMetric';
import { formatScalar } from './format';
import { CardHeader } from './CardHeader';
import { cardClass } from '@/components/ui/Card';

// Not fetched: compare() then reports why there is no comparison.
const NO_PREVIOUS_VALUE: MetricValue = { kind: 'scalar', value: NaN };

// Neutral on purpose: more or fewer is not good or bad for an internal count.
function ComparisonLine({ comparison, def }: { comparison: Comparison; def: MetricDef }) {
  switch (comparison.kind) {
    case 'delta': {
      const { delta } = comparison;
      const arrow = delta === 0 ? '±' : delta > 0 ? '▲ ' : '▼ ';
      return <div className="text-xs text-ink-2 tabular-nums">{`${arrow}${formatScalar(Math.abs(delta), def.format)} mot förra perioden`}</div>;
    }
    case 'both':
      return <div className="text-xs text-ink-2 tabular-nums">{`förra perioden: ${formatScalar(comparison.previous, def.format)}`}</div>;
    case 'unavailable':
      return <div className="text-xs text-ink-3">{comparison.reason}</div>;
  }
}

/** Compact KPI tile. Click/Enter opens the ExplainDrawer for the metric. */
export function MetricTile({ metricKey }: { metricKey: MetricKey }) {
  const { data, previous } = useInsightsContext();
  const [, setSelected] = useSelectedMetric();

  const def = METRICS[metricKey];
  const value = DATA_RESOLVERS[metricKey](data);

  const open = () => setSelected(metricKey);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // the "?" button handles its own keys
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };

  let display: string;
  let spark: { x: string; y: number }[] | null = null;

  if (value.kind === 'scalar') {
    display = formatScalar(value.value, def.format);
    spark = value.trend ?? null;
  } else if (value.kind === 'series') {
    spark = value.points;
    const last = value.points[value.points.length - 1];
    display = last ? formatScalar(last.y, def.format) : '–';
  } else {
    const top = value.entries.find((e) => e.value > 0) ?? value.entries[0];
    display = top ? `${top.label}: ${top.value.toLocaleString('sv-SE')}` : '–';
  }

  // A tile that already says why it has no number does not also explain the comparison.
  const comparison = def.comparable && !value.missing
    ? compare(def, value, previous ? DATA_RESOLVERS[metricKey](previous) : NO_PREVIOUS_VALUE, data, previous)
    : null;

  let sparkEl: ReactNode = null;
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
    const first = spark[0]; const last = spark[spark.length - 1];
    const title = `${first.x}: ${formatScalar(first.y, def.format)} → ${last.x}: ${formatScalar(last.y, def.format)}`;
    sparkEl = (
      <svg className="mt-1 text-acc" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <title>{title}</title>
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
      className={cardClass('px-3 py-2.5 cursor-pointer hover:shadow-lift transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-acc')}
    >
      <CardHeader metricKey={metricKey} />
      {value.missing ? (
        <div className="text-sm leading-tight text-ink-3 mt-1.5">{value.missing}</div>
      ) : (
        <div className="text-3xl leading-tight font-semibold text-ink tabular-nums mt-0.5">{display}</div>
      )}
      {value.kind === 'scalar' && value.note && <div className="text-xs text-ink-3">{value.note}</div>}
      {def.source === 'events' && <div className="text-xs text-ink-3">händelser</div>}
      {comparison && <ComparisonLine comparison={comparison} def={def} />}
      {sparkEl}
    </div>
  );
}
