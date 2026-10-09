'use client';

import { type ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { StarInput } from '@/components/ui/StarInput';
import { cardClass } from '@/components/ui/Card';
import { eyebrowClass } from '@/components/ui/Eyebrow';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  RUNTIME_CEILING,
  RUNTIME_FLOOR,
  RUNTIME_STEP,
  YEAR_FLOOR,
  formatStars,
  runtimeLabel,
  sharedFilterChips,
  type ActiveChip,
  type AvailabilityMode,
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

        <RuntimeRangeSlider
          min={value.runtimeMin}
          max={value.runtimeMax}
          onChange={(runtimeMin, runtimeMax) => set({ runtimeMin, runtimeMax })}
        />

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
 * Two thumbs on one track. The outer stops mean "no bound", so a range pulled to an
 * end keeps everything beyond it.
 */
function RangeSlider({
  title, min, max, floor, ceiling, step, label, lowLabel, highLabel, valueText, onChange,
}: {
  title: string;
  min: number | null;
  max: number | null;
  floor: number;
  ceiling: number;
  step: number;
  label: string;
  lowLabel: string;
  highLabel: string;
  valueText: (v: number, open: boolean) => string;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const lo = min ?? floor;
  const hi = max ?? ceiling;
  const pct = (v: number) => ((v - floor) / (ceiling - floor)) * 100;
  const emit = (a: number, b: number) => onChange(a <= floor ? null : a, b >= ceiling ? null : b);

  return (
    <div>
      <div className={`${capClass} mb-1.5 flex justify-between gap-2`}>
        <span>{title}</span>
        <span className="normal-case tracking-normal text-ink-2 whitespace-nowrap" aria-live="polite">{label}</span>
      </div>
      <div className="range-dual">
        <div className="range-dual-track" />
        <div className="range-dual-fill" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
        <input
          type="range" min={floor} max={ceiling} step={step} value={lo}
          aria-label={lowLabel} aria-valuetext={valueText(lo, min == null)}
          onChange={e => emit(Math.min(Number(e.target.value), hi), hi)}
        />
        <input
          type="range" min={floor} max={ceiling} step={step} value={hi}
          aria-label={highLabel} aria-valuetext={valueText(hi, max == null)}
          onChange={e => emit(lo, Math.max(Number(e.target.value), lo))}
        />
      </div>
    </div>
  );
}

/** At the floor the range also keeps older titles, at the ceiling also undated upcoming ones. */
export function YearRangeSlider({
  min, max, ceiling, onChange,
}: {
  min: number | null;
  max: number | null;
  ceiling: number;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const label = min == null && max == null ? 'Alla år'
    : min == null ? `Till ${max}`
    : max == null ? `Från ${min}`
    : min === max ? String(min) : `${min}–${max}`;
  return (
    <RangeSlider
      title="År" min={min} max={max} floor={YEAR_FLOOR} ceiling={ceiling} step={1} label={label}
      lowLabel="Tidigast år" highLabel="Senast år"
      valueText={(v, open) => open ? (v === YEAR_FLOOR ? 'Inget tidigaste år' : 'Inget senaste år') : String(v)}
      onChange={onChange}
    />
  );
}

/** Minutes per film or per episode; the top stop leaves the upper end open. */
export function RuntimeRangeSlider({
  min, max, onChange,
}: {
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  return (
    <RangeSlider
      title="Längd" min={min} max={max} floor={RUNTIME_FLOOR} ceiling={RUNTIME_CEILING} step={RUNTIME_STEP}
      label={runtimeLabel(min, max)}
      lowLabel="Kortast speltid" highLabel="Längst speltid"
      valueText={(v, open) => open ? (v === RUNTIME_FLOOR ? 'Ingen nedre gräns' : 'Ingen övre gräns') : `${v} minuter`}
      onChange={onChange}
    />
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
