'use client';

import type { MetricKey } from '../metrics/types';
import { DATA_RESOLVERS } from '../metrics/resolvers';
import { METRICS } from '../metrics/catalog';
import { useInsightsContext } from '../state/InsightsContext';

/** Stacked descending funnel bars (e.g. onboarding step drop-off). */
export function Funnel({ metricKey }: { metricKey: MetricKey }) {
  const data = useInsightsContext();
  const value = DATA_RESOLVERS[metricKey](data);
  const label = METRICS[metricKey].label;

  const steps = value.kind === 'funnel' ? value.steps : [];
  const max = steps[0]?.count ?? 0;

  return (
    <div className="bg-surface border border-rule rounded-md p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-2">{label}</div>
      {steps.length === 0 ? (
        <div className="text-sm text-ink-3 py-2">Ingen data</div>
      ) : (
        <div className="flex flex-col gap-2">
          {steps.map((s, i) => (
            <div key={s.name}>
              <div className="flex justify-between text-sm mb-0.5">
                <span className="text-ink">{s.name}</span>
                <span className="text-ink-2 tabular-nums">
                  {s.count.toLocaleString('sv-SE')}
                  {i > 0 && <span className="text-ink-3 ml-1">({s.pctOfStart}%)</span>}
                </span>
              </div>
              <div className="h-5 bg-rule-2 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-acc rounded-sm transition-[width] duration-300"
                  style={{ width: `${max === 0 ? 0 : (s.count / max) * 100}%`, opacity: Math.max(0.45, 1 - i * 0.12) }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
