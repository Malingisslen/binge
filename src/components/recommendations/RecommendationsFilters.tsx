'use client';

import { useEffect, useMemo, useState, useRef, useId } from 'react';
import { Search } from 'lucide-react';
import { GENRE_OPTIONS } from '@/lib/tmdb/genreLabels';
import { getProvider, SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePersistedState } from '@/hooks/usePersistedState';
import {
  DEFAULT_SHARED_FILTERS,
  countSharedFilters,
  sanitizeSharedFilters,
  withoutEmptyMine,
  yearCeiling,
  type SharedFilters,
} from '@/lib/filters/titleFilters';
import { DEFAULT_FILTERS } from '@/types';
import type { FilterState, MediaTypeFilter, RecSortKey } from '@/types';
import { Segmented } from '@/components/ui/Segmented';
import { eyebrowClass } from '@/components/ui/Eyebrow';
import {
  ActiveFilterChips,
  FilterPanel,
  FilterToggle,
  sharedChipsFor,
  type ServiceChoice,
} from '@/components/filters/TitleFilters';

const COUNTRIES = ['SE', 'NO', 'DK', 'FI', 'GB', 'US', 'FR', 'DE', 'JP', 'KR', 'IT', 'ES'];

const SORTS: ReadonlyArray<{ value: RecSortKey; label: string }> = [
  { value: 'relevance', label: 'Relevans' },
  { value: 'rating', label: 'Betyg' },
  { value: 'release', label: 'Premiärdatum' },
];

const MEDIA: ReadonlyArray<{ value: MediaTypeFilter; label: string }> = [
  { value: 'all', label: 'Alla' },
  { value: 'tv', label: 'Serier' },
  { value: 'movie', label: 'Film' },
];

// Streaming services a suggestion can be filtered to; rent-and-buy stores are not "on" a service.
const SERVICE_CHOICES: ServiceChoice[] = SWEDISH_PROVIDERS
  .filter(p => p.type === 'flatrate')
  .map(p => ({ id: p.id, name: p.shortName }))
  .sort((a, b) => a.name.localeCompare(b.name, 'sv'));

const serviceName = (id: number) => getProvider(id)?.shortName ?? `Tjänst ${id}`;

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['sv'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

type StoredFilters = Pick<FilterState, keyof SharedFilters | 'mediaType' | 'country' | 'sort'>;
const STORAGE_KEY = 'binge:filters:recommendations';

export function sanitizeStored(raw: unknown): StoredFilters {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    ...sanitizeSharedFilters(r),
    mediaType: r.mediaType === 'movie' || r.mediaType === 'tv' ? r.mediaType : 'all',
    country: typeof r.country === 'string' && COUNTRIES.includes(r.country) ? r.country : '',
    sort: SORTS.some(s => s.value === r.sort) ? r.sort as RecSortKey : 'relevance',
  };
}

const STORED_DEFAULT: StoredFilters = sanitizeStored({});

const pickShared = (f: SharedFilters): SharedFilters => ({
  genres: f.genres, availability: f.availability, services: f.services,
  runtimeMin: f.runtimeMin, runtimeMax: f.runtimeMax, yearMin: f.yearMin, yearMax: f.yearMax, minStars: f.minStars,
});

/**
 * Rekommendationer's filter state: the user's choices survive a reload (shared by the
 * hub and the expanded row), while the profile-driven always-on filters follow the profile.
 */
export function useRecommendationFilters(profile: {
  hideNonLatinTitles: boolean;
  hiddenCountries: readonly string[];
  myProviders: readonly number[];
}) {
  const [stored, setStored] = usePersistedState<StoredFilters>(STORAGE_KEY, STORED_DEFAULT, sanitizeStored);
  const [searchText, setSearchText] = useState('');
  const filters: FilterState = useMemo(
    () => withoutEmptyMine(
      { ...DEFAULT_FILTERS, ...stored, searchText, hideNonLatinTitles: profile.hideNonLatinTitles, hiddenCountries: profile.hiddenCountries },
      profile.myProviders,
    ),
    [stored, searchText, profile.hideNonLatinTitles, profile.hiddenCountries, profile.myProviders],
  );
  const setFilters = (next: FilterState) => {
    setStored({
      ...pickShared(next),
      mediaType: next.mediaType,
      country: next.country,
      sort: next.sort,
    });
    setSearchText(next.searchText);
  };
  const clearAll = () => { setStored(s => ({ ...s, ...DEFAULT_SHARED_FILTERS, country: '' })); setSearchText(''); };
  return { filters, setFilters, clearAll };
}

/** Number of narrowing filters on (media type and sort excluded: they reorder or switch views). */
export const activeRecFilterCount = (f: FilterState) => countSharedFilters(f) + (f.country ? 1 : 0) + (f.searchText ? 1 : 0);

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  onClearAll: () => void;
  hasMyProviders: boolean;
}

export default function RecommendationsFilters({ filters, onChange, onClearAll, hasMyProviders }: Props) {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(filters.searchText);
  const debouncedSearch = useDebouncedValue(searchInput, 200);
  const prevSearchRef = useRef(filters.searchText);
  const countryId = useId();
  const sortId = useId();

  useEffect(() => {
    // Wait until the debounce has caught up with the field; an older value would
    // write a search back that was just cleared.
    if (debouncedSearch !== searchInput) return;
    if (debouncedSearch !== prevSearchRef.current) {
      onChange({ ...filters, searchText: debouncedSearch });
      prevSearchRef.current = debouncedSearch;
    }
  }, [debouncedSearch, searchInput, onChange, filters]);

  // "Rensa alla" empties the search from outside; mirror it in the field.
  useEffect(() => {
    if (filters.searchText === '' && prevSearchRef.current !== '') {
      prevSearchRef.current = '';
      setSearchInput('');
    }
  }, [filters.searchText]);

  const setShared = (next: SharedFilters) => onChange({ ...filters, ...next });
  const chips = [
    ...sharedChipsFor(filters, setShared, serviceName),
    ...(filters.country
      ? [{ key: 'country', label: countryName(filters.country), onRemove: () => onChange({ ...filters, country: '' }) }]
      : []),
    ...(filters.searchText
      ? [{ key: 'search', label: `"${filters.searchText}"`, onRemove: () => { setSearchInput(''); onChange({ ...filters, searchText: '' }); } }]
      : []),
  ];

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="Filtrera på medietyp"
          value={filters.mediaType}
          onChange={mediaType => onChange({ ...filters, mediaType })}
          options={[...MEDIA]}
        />
        <label className="field field-sm inline-flex items-center gap-1.5 flex-1 min-w-[160px] max-w-[320px]">
          <Search size={12} className="text-ink-3" aria-hidden />
          <input
            type="search"
            placeholder="Sök i rekommendationer…"
            aria-label="Sök i rekommendationer"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="bg-transparent border-0 outline-none w-full text-ink"
          />
        </label>
        <label htmlFor={sortId} className="sr-only">Sortering</label>
        <select
          id={sortId}
          value={filters.sort}
          onChange={e => onChange({ ...filters, sort: e.target.value as RecSortKey })}
          className="select"
        >
          {SORTS.map(s => <option key={s.value} value={s.value}>Sortera: {s.label}</option>)}
        </select>
        <div className="ml-auto">
          <FilterToggle open={open} activeCount={activeRecFilterCount(filters)} onToggle={() => setOpen(o => !o)} />
        </div>
      </div>

      {open && (
        <FilterPanel
          value={filters}
          onChange={setShared}
          onClose={() => setOpen(false)}
          genreOptions={GENRE_OPTIONS}
          services={SERVICE_CHOICES}
          hasMyServices={hasMyProviders}
          yearCeiling={yearCeiling()}
          extra={
            <div>
              <label htmlFor={countryId} className={`${eyebrowClass({ size: 'xs' })} block mb-1.5`}>Land</label>
              <select
                id={countryId}
                className="select w-full"
                value={filters.country}
                onChange={e => onChange({ ...filters, country: e.target.value })}
              >
                <option value="">Alla länder</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{countryName(c)}</option>)}
              </select>
            </div>
          }
        />
      )}

      <ActiveFilterChips chips={chips} onClearAll={onClearAll} />
    </div>
  );
}
