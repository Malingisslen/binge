'use client';

import type { MetricKey } from '../metrics/types';
import { DATA_RESOLVERS } from '../metrics/resolvers';
import { METRICS } from '../metrics/catalog';
import { useInsightsContext } from '../state/InsightsContext';

/** Vertical-bar histogram for a breakdown metric (e.g. ratings 1–10). */
export function Histogram({ metricKey }: { metricKey: MetricKey }) {
  const data = useInsightsContext();
  const value = DATA_RESOLVERS[metricKey](data);
  const label = METRICS[metricKey].label;

  const entries = value.kind === 'breakdown' ? value.entries : [];
  const max = entries.reduce((m, e) => Math.max(m, e.value), 0);
  const hasData = entries.some((e) => e.value > 0);

  return (
    <div className="bg-surface border border-rule rounded-md p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-2">{label}</div>
      {!hasData ? (
        <div className="text-sm text-ink-3 py-2">Ingen data</div>
      ) : (
        <div className="flex items-end gap-1 h-28">
          {entries.map((e) => (
            <div key={e.label} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${e.label}: ${e.value}`}>
              <div
                className="w-full bg-acc rounded-sm min-h-[2px]"
                style={{ height: `${max === 0 ? 0 : (e.value / max) * 100}%` }}
              />
              <span className="text-[10px] text-ink-3 tabular-nums">{e.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
