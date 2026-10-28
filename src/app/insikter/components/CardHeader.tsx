'use client';

import { CircleHelp } from 'lucide-react';
import type { MetricKey } from '../metrics/types';
import { METRICS } from '../metrics/catalog';
import { useSelectedMetric } from '../state/useSelectedMetric';
import { eyebrowClass } from '@/components/ui/Eyebrow';

/**
 * The label row every metric card shares: the name, a "just nu" tag on snapshots
 * (they ignore the date picker), and a "?". The whole row is the button that opens
 * the ExplainDrawer, so a chart card is explained from its title without the chart
 * itself having to be clickable. It stops propagation so a tile that is clickable
 * as a whole (MetricTile) does not open the drawer twice.
 */
export function CardHeader({ metricKey, className }: { metricKey: MetricKey; className?: string }) {
  const [, setSelected] = useSelectedMetric();
  const def = METRICS[metricKey];

  return (
    <button
      type="button"
      aria-label={`${def.label} – vad mäter det här?`}
      onClick={(e) => { e.stopPropagation(); setSelected(metricKey); }}
      onKeyDown={(e) => e.stopPropagation()}
      className={['flex w-full items-center gap-1.5 text-left text-ink-3 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-acc rounded-sm', className].filter(Boolean).join(' ')}
    >
      <span className={eyebrowClass({ size: 'xs' })}>{def.label}</span>
      {def.snapshot && <span className="text-xxs text-ink-3">just nu</span>}
      <CircleHelp size={14} aria-hidden className="ml-auto shrink-0" />
    </button>
  );
}
