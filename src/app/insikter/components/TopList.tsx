'use client';

import type { MetricKey } from '../metrics/types';
import { DATA_RESOLVERS } from '../metrics/resolvers';
import { METRICS } from '../metrics/catalog';
import { useInsightsContext } from '../state/InsightsContext';

/** Ranked horizontal-bar list of the top entries for a breakdown metric. */
export function TopList({ metricKey }: { metricKey: MetricKey }) {
  const data = useInsightsContext();
  const value = DATA_RESOLVERS[metricKey](data);
  const label = METRICS[metricKey].label;

  const entries = value.kind === 'breakdown' ? value.entries.filter((e) => e.value > 0).slice(0, 10) : [];
  const max = entries[0]?.value ?? 0;

  return (
    <div className="bg-surface border border-rule rounded-md p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-2">{label}</div>
      {entries.length === 0 ? (
        <div className="text-sm text-ink-3 py-2">Ingen data</div>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {entries.map((e, i) => (
            <li key={`${e.label}-${i}`} className="flex items-center gap-2 text-sm">
              <span className="w-4 text-right text-ink-3 tabular-nums text-[11px]">{i + 1}</span>
              <span className="flex-1 truncate text-ink" title={e.label}>{e.label}</span>
              <span className="w-[38%] h-1.5 bg-rule-2 rounded-sm overflow-hidden">
                <span className="block h-full bg-acc rounded-sm" style={{ width: `${max === 0 ? 0 : (e.value / max) * 100}%` }} />
              </span>
              <span className="w-10 text-right text-ink-2 tabular-nums">{e.value.toLocaleString('sv-SE')}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
