'use client';

import { useState } from 'react';
import { GENRE_OPTIONS } from '@/lib/tmdb/genreLabels';
import { DEFAULT_SHARED_FILTERS, countSharedFilters, yearCeiling, type SharedFilters } from '@/lib/filters/titleFilters';
import { ActiveFilterChips, FilterPanel, FilterToggle, FilteredEmptyState, sharedChipsFor } from './TitleFilters';

const SERVICES = [
  { id: 76, name: 'Viaplay', count: 14 },
  { id: 8, name: 'Netflix', count: 9 },
  { id: 337, name: 'Disney+', count: 4 },
];
const names: Record<number, string> = { 76: 'Viaplay', 8: 'Netflix', 337: 'Disney+' };

/** The shared filter panel on /designsystem/, with example services and live state. */
export default function FilterPanelDemo() {
  const [open, setOpen] = useState(true);
  const [f, setF] = useState<SharedFilters>({
    ...DEFAULT_SHARED_FILTERS, availability: 'specific', services: [76], genres: ['35'], yearMin: 1990, minStars: 3.5,
  });
  return (
    <div>
      <FilterToggle open={open} activeCount={countSharedFilters(f)} onToggle={() => setOpen(o => !o)} />
      {open && (
        <FilterPanel
          value={f}
          onChange={setF}
          onClose={() => setOpen(false)}
          genreOptions={GENRE_OPTIONS.slice(0, 8)}
          services={SERVICES}
          hasMyServices
          yearCeiling={yearCeiling()}
        />
      )}
      <ActiveFilterChips chips={sharedChipsFor(f, setF, id => names[id] ?? '')} onClearAll={() => setF(DEFAULT_SHARED_FILTERS)} />
      <div className="mt-3">
        <FilteredEmptyState noun="titlar" onClearAll={() => setF(DEFAULT_SHARED_FILTERS)} />
      </div>
    </div>
  );
}
