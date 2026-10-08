'use client';

import type { ReactNode } from 'react';

// Segmentkontroll (variant 2): en bordad grupp där exakt ett val är aktivt (ink-
// fyllt). Semantiskt rätt för ömsesidigt uteslutande val (medietyp, vyläge) och
// kompaktare än fristående chips. Ikon-only-segment får title/aria-label.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label?: string; icon?: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{ display: 'inline-flex', border: '1px solid var(--rule)', borderRadius: 6, overflow: 'hidden', background: 'var(--surface)' }}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            // Ikon-only-segment behöver namn för skärmläsare/tooltip; text-segment
            // har redan sin etikett synlig, så inget redundant title/aria där.
            aria-label={o.label ? undefined : o.title}
            title={o.label ? undefined : o.title}
            onClick={() => onChange(o.value)}
            className="inline-flex items-center gap-1.5 cursor-pointer"
            style={{
              padding: o.label ? '5px 11px' : '6px 9px',
              fontFamily: 'inherit',
              fontSize: 'var(--fs-sm)',
              border: 0,
              borderLeft: i > 0 ? '1px solid var(--rule)' : undefined,
              background: active ? 'var(--ink)' : 'transparent',
              color: active ? 'var(--bg)' : 'var(--ink-2)',
            }}
          >
            {o.icon}
            {o.label && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

// En aktiv-filter-pill: accent-chip med titel + kryss, klick tar bort filtret.
// Delas av genre/betyg/tagg-pillsen så etikett + layout bor på ett ställe.
