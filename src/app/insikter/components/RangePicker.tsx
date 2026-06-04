'use client';

import { useDateRange } from '../state/useDateRange';
import type { DateRange } from '../state/useDateRange';

type Preset = DateRange['preset'];

const PRESETS: { label: string; value: Exclude<Preset, 'custom'> }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
];

/** Preset date-range pills. Custom ("Egen…") range lands in Fas 2. */
export function RangePicker() {
  const [range, setRange] = useDateRange();
  return (
    <div className="inline-flex rounded-md border border-rule overflow-hidden">
      {PRESETS.map((p) => {
        const active = range.preset === p.value;
        return (
          <button
            key={p.value}
            type="button"
            aria-pressed={active}
            onClick={() => setRange({ preset: p.value, from: '', to: '' })}
            className={`px-3 py-1.5 text-sm border-r border-rule last:border-r-0 transition-colors ${
              active ? 'bg-acc text-white font-medium' : 'bg-surface text-ink-2 hover:bg-bg-2'
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
