'use client';

import { useSelectedMetric } from '../state/useSelectedMetric';
import { METRICS } from '../metrics/catalog';
import { EXPLANATIONS } from '../metrics/explanations';

/** Self-renders from the ?metric URL param: a side panel explaining a metric. */
export function ExplainDrawer() {
  const [selected, setSelected] = useSelectedMetric();
  if (!selected) return null;

  const def = METRICS[selected];
  const ex = EXPLANATIONS[selected];
  const close = () => setSelected(null);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={def.label}>
      <button type="button" aria-label="Stäng" onClick={close} className="absolute inset-0 bg-ink/30" />
      <div className="relative w-full max-w-sm h-full bg-surface border-l border-rule shadow-pop p-5 overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-[18px] font-semibold text-ink">{def.label}</h2>
          <button type="button" onClick={close} className="text-ink-3 hover:text-ink text-sm">Stäng</button>
        </div>
        {ex ? (
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-ink-3 text-[11px] uppercase tracking-wide">Vad är det?</dt>
              <dd className="text-ink-2">{ex.whatIsIt}</dd>
            </div>
            <div>
              <dt className="text-ink-3 text-[11px] uppercase tracking-wide">Hur beräknas det?</dt>
              <dd className="text-ink-2">{ex.howCalculated}</dd>
            </div>
            <div>
              <dt className="text-ink-3 text-[11px] uppercase tracking-wide">Varför viktigt?</dt>
              <dd className="text-ink-2">{ex.whyImportant}</dd>
            </div>
            <div>
              <dt className="text-ink-3 text-[11px] uppercase tracking-wide">Källa</dt>
              <dd className="text-ink-2">{ex.source}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-ink-2">Ingen förklaring tillgänglig för det här måttet ännu.</p>
        )}
      </div>
    </div>
  );
}
