import { describe, it, expect } from 'vitest';
import { pickSwedishDigitalRelease, pickSwedishTheatricalRelease, cinemaToStreaming } from './releaseDate';
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

describe('pickSwedishTheatricalRelease', () => {
  it('returns the earliest SE theatrical (type 3 or limited type 2) date', () => {
    const m = movieWith([
      { iso_3166_1: 'SE', release_dates: [
        { type: 3, release_date: '2026-05-15T00:00:00.000Z', note: '' },
        { type: 2, release_date: '2026-05-01T00:00:00.000Z', note: '' },
      ] },
    ]);
    expect(pickSwedishTheatricalRelease(m)).toBe('2026-05-01');
  });

  it('ignores digital (type 4) and returns null without a theatrical date', () => {
    const m = movieWith([
      { iso_3166_1: 'SE', release_dates: [{ type: 4, release_date: '2026-06-20T00:00:00.000Z', note: '' }] },
    ]);
    expect(pickSwedishTheatricalRelease(m)).toBeNull();
  });

  it('returns null when release_dates is missing entirely', () => {
    expect(pickSwedishTheatricalRelease({ id: 1 } as TMDBMovie)).toBeNull();
  });
});

describe('cinemaToStreaming', () => {
  const inCinemasFutureDigital = movieWith([
    { iso_3166_1: 'SE', release_dates: [
      { type: 3, release_date: '2026-06-01T00:00:00.000Z', note: '' }, // opened in cinemas
      { type: 4, release_date: '2026-07-12T00:00:00.000Z', note: '' }, // digital, future
    ] },
  ]);

  it('returns the digital date + whole-day countdown when in cinemas with a future digital date', () => {
    expect(cinemaToStreaming(inCinemasFutureDigital, '2026-06-28')).toEqual({
      digitalDate: '2026-07-12',
      daysUntil: 14,
    });
  });

  it('is non-null on the exact theatrical opening day (strict > boundary)', () => {
    // theatrical = 2026-06-01; opening day itself counts as "in cinemas".
    expect(cinemaToStreaming(inCinemasFutureDigital, '2026-06-01')).not.toBeNull();
  });

  it('returns null before the film has opened in cinemas', () => {
    expect(cinemaToStreaming(inCinemasFutureDigital, '2026-05-20')).toBeNull();
  });

  it('returns null once the digital date has passed (already streaming)', () => {
    expect(cinemaToStreaming(inCinemasFutureDigital, '2026-07-12')).toBeNull(); // releases today → not a countdown
    expect(cinemaToStreaming(inCinemasFutureDigital, '2026-08-01')).toBeNull();
  });

  it('returns null without a theatrical date (e.g. straight-to-streaming)', () => {
    const m = movieWith([
      { iso_3166_1: 'SE', release_dates: [{ type: 4, release_date: '2026-07-12T00:00:00.000Z', note: '' }] },
    ]);
    expect(cinemaToStreaming(m, '2026-06-28')).toBeNull();
  });

  it('returns null without a digital date', () => {
    const m = movieWith([
      { iso_3166_1: 'SE', release_dates: [{ type: 3, release_date: '2026-06-01T00:00:00.000Z', note: '' }] },
    ]);
    expect(cinemaToStreaming(m, '2026-06-28')).toBeNull();
  });
});
