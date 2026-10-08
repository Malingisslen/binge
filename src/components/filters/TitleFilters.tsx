'use client';

import { useId, type ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { StarInput } from '@/components/ui/StarInput';
import { cardClass } from '@/components/ui/Card';
import { eyebrowClass } from '@/components/ui/Eyebrow';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  LENGTH_OPTIONS,
  YEAR_FLOOR,
  formatStars,
  sharedFilterChips,
  type ActiveChip,
  type AvailabilityMode,
  type LengthFilter,
  type SharedFilters,
} from '@/lib/filters/titleFilters';
import type { GenreOption } from '@/lib/tmdb/genreLabels';

export interface ServiceChoice {
  id: number;
  name: string;
  /** How many of the listed titles stream there; left out where it is not known. */
  count?: number;
}

const capClass = eyebrowClass({ size: 'xs' });

/** The toolbar button that opens the panel; shows how many filters are on. */
export function FilterToggle({ open, activeCount, onToggle }: { open: boolean; activeCount: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`chip${open || activeCount > 0 ? ' is-on' : ''} inline-flex items-center gap-1.5`}
      aria-expanded={open}
    >
      <SlidersHorizontal size={13} aria-hidden />
      Filter
      {activeCount > 0 && (
        <span className="rounded-sm bg-bg px-1.5 text-xxs font-bold text-ink" aria-label={`${activeCount} aktiva`}>
          {activeCount}
        </span>
      )}
    </button>
  );
}

interface PanelProps {
  value: SharedFilters;
  onChange: (next: SharedFilters) => void;
  onClose: () => void;
  genreOptions: readonly GenreOption[];
  services: readonly ServiceChoice[];
  /** False hides "Mina tjänster": without services of your own it would filter nothing. */
  hasMyServices: boolean;
  yearCeiling: number;
  /** The page's own axes (Status, Land, Taggar), rendered after the shared ones. */
  extra?: ReactNode;
}

export function FilterPanel({
  value, onChange, onClose, genreOptions, services, hasMyServices, yearCeiling, extra,
}: PanelProps) {
  const lengthId = useId();
  const set = (patch: Partial<SharedFilters>) => onChange({ ...value, ...patch });
  const availabilityOptions: { value: AvailabilityMode; label: string }[] = [
    { value: 'all', label: 'Alla' },
    ...(hasMyServices ? [{ value: 'mine' as const, label: 'Mina tjänster' }] : []),
    { value: 'specific', label: 'Specifik tjänst' },
  ];
  const toggleService = (id: number) =>
    set({ services: value.services.includes(id) ? value.services.filter(s => s !== id) : [...value.services, id] });
  const toggleGenre = (g: string) =>
    set({ genres: value.genres.includes(g) ? value.genres.filter(x => x !== g) : [...value.genres, g] });

  return (
    <section className={cardClass('p-4 mt-3')} aria-label="Filter">
      <div className="flex items-center justify-between mb-3">
        <span className={capClass}>Filter</span>
        <button type="button" onClick={onClose} className="topbar-icon-btn text-ink-3" aria-label="Stäng filter">
          <X size={14} />
        </button>
      </div>

      <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
        <div className="col-span-full">
          <div className={`${capClass} mb-1.5`}>Tillgänglighet</div>
          <Segmented
            ariaLabel="Tillgänglighet"
            value={value.availability === 'mine' && !hasMyServices ? 'all' : value.availability}
            onChange={availability => set({ availability, services: availability === 'specific' ? value.services : [] })}
            options={availabilityOptions}
          />
          {value.availability === 'specific' && (
            <fieldset className="mt-2.5">
              <legend className="text-xs text-ink-3 mb-1.5">
                {value.services.length > 0
                  ? 'Visar titlar som finns på någon av de valda tjänsterna.'
                  : 'Välj en eller flera tjänster.'}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {services.map(s => {
                  const on = value.services.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleService(s.id)}
                      className={`chip${on ? ' is-on' : ''} inline-flex items-center gap-1.5`}
                    >
                      {s.name}
                      {s.count != null && <span className={on ? 'opacity-70' : 'text-ink-3'}>{s.count}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>

        {genreOptions.length > 0 && (
          <fieldset className="col-span-full">
            <legend className={`${capClass} mb-1.5`}>Genre</legend>
            <div className="flex flex-wrap gap-1.5">
              {genreOptions.map(g => {
                const on = value.genres.includes(g.value);
                return (
                  <button
                    key={g.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleGenre(g.value)}
                    className={`chip${on ? ' is-on' : ''}`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <div>
          <label htmlFor={lengthId} className={`${capClass} block mb-1.5`}>Längd</label>
          <select
            id={lengthId}
            className="select w-full"
            value={value.length}
            onChange={e => set({ length: e.target.value as LengthFilter })}
          >
            {LENGTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <YearRangeSlider
          min={value.yearMin}
          max={value.yearMax}
          ceiling={yearCeiling}
          onChange={(yearMin, yearMax) => set({ yearMin, yearMax })}
        />

        <StarFloor value={value.minStars} onChange={minStars => set({ minStars })} />

        {extra}
      </div>
    </section>
  );
}

/**
 * Two thumbs on one track. The outer stops mean "no bound": at the floor the range
 * also keeps older titles, at the ceiling also undated upcoming ones.
 */
export function YearRangeSlider({
  min, max, ceiling, onChange,
}: {
  min: number | null;
  max: number | null;
  ceiling: number;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const lo = min ?? YEAR_FLOOR;
  const hi = max ?? ceiling;
  const span = ceiling - YEAR_FLOOR;
  const pct = (y: number) => ((y - YEAR_FLOOR) / span) * 100;
  const emit = (a: number, b: number) => onChange(a <= YEAR_FLOOR ? null : a, b >= ceiling ? null : b);
  const label = min == null && max == null ? 'Alla år'
    : min == null ? `Till ${max}`
    : max == null ? `Från ${min}`
    : min === max ? String(min) : `${min}–${max}`;

  return (
    <div>
      <div className={`${capClass} mb-1.5 flex justify-between gap-2`}>
        <span>År</span>
        <span className="normal-case tracking-normal text-ink-2 whitespace-nowrap" aria-live="polite">{label}</span>
      </div>
      <div className="range-dual">
        <div className="range-dual-track" />
        <div className="range-dual-fill" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
        <input
          type="range" min={YEAR_FLOOR} max={ceiling} step={1} value={lo}
          aria-label="Tidigast år" aria-valuetext={min == null ? 'Inget tidigaste år' : String(lo)}
          onChange={e => emit(Math.min(Number(e.target.value), hi), hi)}
        />
        <input
          type="range" min={YEAR_FLOOR} max={ceiling} step={1} value={hi}
          aria-label="Senast år" aria-valuetext={max == null ? 'Inget senaste år' : String(hi)}
          onChange={e => emit(lo, Math.max(Number(e.target.value), lo))}
        />
      </div>
    </div>
  );
}

/** Lowest rating as five stars in half steps; choosing the current value again clears it. */
export function StarFloor({ value, onChange }: { value: number; onChange: (stars: number) => void }) {
  return (
    <div>
      <div className={`${capClass} mb-1.5 flex justify-between gap-2`}>
        <span>Lägsta betyg</span>
        <span className="normal-case tracking-normal text-ink-2 whitespace-nowrap" aria-live="polite">
          {value > 0 ? `${formatStars(value)} eller mer` : 'Alla betyg'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <StarInput
          value={value}
          onSelect={v => onChange(value === v ? 0 : v)}
          labelFor={v => `${formatStars(v)} stjärnor eller mer`}
          groupLabel="Lägsta betyg i stjärnor"
        />
        {value > 0 && (
          <button type="button" className="text-xs text-ink-3 underline cursor-pointer bg-transparent border-0 p-0" onClick={() => onChange(0)}>
            Alla
          </button>
        )}
      </div>
    </div>
  );
}

/** Removable chips for every active filter, then "Rensa alla". */
export function ActiveFilterChips({
  chips, onClearAll,
}: {
  chips: readonly { key: string; label: string; onRemove: () => void }[];
  onClearAll: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-2.5" aria-label="Aktiva filter">
      {chips.map(c => (
        <button
          key={c.key}
          type="button"
          onClick={c.onRemove}
          className="chip acc inline-flex items-center gap-1.5"
          aria-label={`Ta bort filter: ${c.label}`}
        >
          {c.label}
          <X size={11} aria-hidden />
        </button>
      ))}
      <button type="button" onClick={onClearAll} className="chip border-dashed">
        Rensa alla
      </button>
    </div>
  );
}

/** Shared-axis chips wired to a SharedFilters setter. */
export function sharedChipsFor(
  value: SharedFilters,
  onChange: (next: SharedFilters) => void,
  serviceName: (id: number) => string,
): { key: string; label: string; onRemove: () => void }[] {
  return sharedFilterChips(value, serviceName).map((c: ActiveChip) => ({
    key: c.key,
    label: c.label,
    onRemove: () => onChange(c.clear(value)),
  }));
}

/** What a list says when its filters leave nothing: why, and the way back. */
export function FilteredEmptyState({ noun, onClearAll }: { noun: string; onClearAll: () => void }) {
  return (
    <EmptyState
      title={`Inga ${noun} matchar filtren`}
      body="Ta bort ett filter eller rensa alla för att se fler."
      action={<Button type="button" variant="acc" onClick={onClearAll}>Rensa alla filter</Button>}
    />
  );
}
