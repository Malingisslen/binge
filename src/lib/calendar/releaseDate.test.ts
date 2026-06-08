import { describe, it, expect } from 'vitest';
import { pickSwedishDigitalRelease } from './releaseDate';
import type { TMDBMovie, TMDBReleaseDatesByCountry } from '@/types';

function movieWith(results: TMDBReleaseDatesByCountry[]): TMDBMovie {
  return {
    id: 1, title: 'm', original_title: 'm', overview: '', poster_path: null,
    backdrop_path: null, release_date: '', runtime: 0, vote_average: 0,
    vote_count: 0, genres: [], release_dates: { results },
  } as TMDBMovie;
}

describe('pickSwedishDigitalRelease', () => {
  it('returns the SE digital (type 4) date as yyyy-mm-dd', () => {
    const m = movieWith([
      { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-05-01T00:00:00.000Z', note: '' }] },
      { iso_3166_1: 'SE', release_dates: [{ type: 4, release_date: '2026-06-20T00:00:00.000Z', note: '' }] },
    ]);
    expect(pickSwedishDigitalRelease(m)).toBe('2026-06-20');
  });

  it('ignores SE theatrical (type 3) dates', () => {
    const m = movieWith([
      { iso_3166_1: 'SE', release_dates: [{ type: 3, release_date: '2026-06-01T00:00:00.000Z', note: '' }] },
    ]);
    expect(pickSwedishDigitalRelease(m)).toBeNull();
  });

  it('picks the earliest when SE has several digital dates', () => {
    const m = movieWith([
      { iso_3166_1: 'SE', release_dates: [
        { type: 4, release_date: '2026-08-01T00:00:00.000Z', note: '' },
        { type: 4, release_date: '2026-06-20T00:00:00.000Z', note: '' },
      ] },
    ]);
    expect(pickSwedishDigitalRelease(m)).toBe('2026-06-20');
  });

  it('returns null when there is no SE entry', () => {
    const m = movieWith([
      { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-06-20T00:00:00.000Z', note: '' }] },
    ]);
    expect(pickSwedishDigitalRelease(m)).toBeNull();
  });

  it('returns null when release_dates is missing', () => {
    expect(pickSwedishDigitalRelease({ id: 1 } as TMDBMovie)).toBeNull();
  });
});
