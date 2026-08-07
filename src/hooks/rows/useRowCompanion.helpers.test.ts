import { describe, it, expect } from 'vitest';
import { toRowTitle } from './useRowCompanion.helpers';
import { applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { FilterState, TMDBMovie } from '@/types';

function movie(overrides: Partial<TMDBMovie> = {}): TMDBMovie {
  return {
    id: 559969,
    title: 'El Camino',
    original_title: 'El Camino: A Breaking Bad Movie',
    overview: '',
    poster_path: null,
    backdrop_path: null,
    release_date: '2019-10-11',
    runtime: 122,
    vote_average: 7,
    vote_count: 3000,
    genres: [{ id: 80, name: 'Crime' }],
    ...overrides,
  };
}

function filters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    mediaType: 'all',
    genre: '',
    country: '',
    decade: '',
    hiddenCountries: [],
    hideNonLatinTitles: false,
    ...overrides,
  } as FilterState;
}

describe('toRowTitle', () => {
  it('maps detail `genres` onto the list-shaped `genre_ids`', () => {
    expect(toRowTitle(movie()).genre_ids).toEqual([80]);
  });

  it('carries origin_country through so the country filter can see it', () => {
    const t = toRowTitle(movie({ origin_country: ['US'] }));
    expect(t.origin_country).toEqual(['US']);
    // The filter is the reason the field has to survive the mapping at all.
    expect(applyClientFilters([t], filters({ country: 'US' }))).toHaveLength(1);
    expect(applyClientFilters([t], filters({ country: 'SE' }))).toHaveLength(0);
  });

  it('falls back to production_countries when the payload has no origin_country', () => {
    const t = toRowTitle(
      movie({
        production_countries: [
          { iso_3166_1: 'GB', name: 'United Kingdom' },
          { iso_3166_1: 'US', name: 'United States' },
        ],
      }),
    );
    expect(t.origin_country).toEqual(['GB', 'US']);
  });

  it('honours the saved "dölj länder" setting — a companion film is not exempt', () => {
    const t = toRowTitle(movie({ origin_country: ['KR'] }));
    expect(applyClientFilters([t], filters({ hiddenCountries: ['KR'] }))).toHaveLength(0);
    expect(applyClientFilters([t], filters({ hiddenCountries: ['JP'] }))).toHaveLength(1);
  });

  it('leaves origin_country undefined when the payload carries neither field', () => {
    expect(toRowTitle(movie()).origin_country).toBeUndefined();
  });
});
