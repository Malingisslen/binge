'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMovieGenres, getTVGenres } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { FilterState } from '@/types';

const DECADES = ['1960', '1970', '1980', '1990', '2000', '2010', '2020'];
const COUNTRIES = ['SE', 'NO', 'DK', 'FI', 'GB', 'US', 'FR', 'DE', 'JP', 'KR', 'IT', 'ES'];

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  hasMyProviders: boolean;
}

export default function RecommendationsFilters({ filters, onChange, hasMyProviders }: Props) {
  const [searchInput, setSearchInput] = useState(filters.searchText);
  const debouncedSearch = useDebouncedValue(searchInput, 200);

  useEffect(() => {
    if (debouncedSearch !== filters.searchText) {
      onChange({ ...filters, searchText: debouncedSearch });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const { data: movieGenres } = useQuery({
    queryKey: ['genres-movie'],
    queryFn: getMovieGenres,
    staleTime: TMDB_STALE.GENRES,
  });
  const { data: tvGenres } = useQuery({
    queryKey: ['genres-tv'],
    queryFn: getTVGenres,
    staleTime: TMDB_STALE.GENRES,
  });

  const allGenres = (() => {
    const merged = [...(movieGenres?.genres ?? []), ...(tvGenres?.genres ?? [])];
    const seen = new Set<number>();
    return merged
      .filter(g => { if (seen.has(g.id)) return false; seen.add(g.id); return true; })
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  })();

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <select
        value={filters.genre}
        onChange={e => onChange({ ...filters, genre: e.target.value })}
        className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary outline-none"
      >
        <option value="">Alla genrer</option>
        {allGenres.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
      </select>
      <select
        value={filters.country}
        onChange={e => onChange({ ...filters, country: e.target.value })}
        className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary outline-none"
      >
        <option value="">Alla länder</option>
        {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        value={filters.decade}
        onChange={e => onChange({ ...filters, decade: e.target.value })}
        className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary outline-none"
      >
        <option value="">Alla decennier</option>
        {DECADES.map(d => <option key={d} value={d}>{d}-talet</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs text-text-secondary">
        Betyg ≥
        <input
          type="number" min={0} max={9} step={0.5}
          value={filters.voteAverageMin}
          onChange={e => onChange({ ...filters, voteAverageMin: Number(e.target.value) })}
          className="w-12 text-xs border border-border-main rounded-sm px-1 py-[2px] bg-surface"
        />
      </label>
      {hasMyProviders && (
        <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={filters.myProvidersOnly}
            onChange={e => onChange({ ...filters, myProvidersOnly: e.target.checked })}
            className="accent-accent w-[13px] h-[13px]"
          />
          Mina tjänster
        </label>
      )}
      <input
        type="search"
        placeholder="Sök i rekommendationer…"
        value={searchInput}
        onChange={e => setSearchInput(e.target.value)}
        className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary outline-none flex-1 min-w-[160px]"
      />
    </div>
  );
}
