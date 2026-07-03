import { describe, it, expect } from 'vitest';
import { movieContentFloorInput, tvContentFloorInput } from './contentFloorInput';
import type { TMDBMovie, TMDBTVShow } from '@/types/tmdb';

const movie = {
  id: 27205,
  title: 'Inception',
  original_title: 'Inception',
  overview: 'En tjuv...',
  release_date: '2010-07-15',
  runtime: 148,
  genres: [{ id: 878, name: 'Science Fiction' }, { id: 28, name: 'Action' }],
  credits: {
    cast: [
      { id: 2, name: 'Leonardo DiCaprio', character: 'Cobb', profile_path: null, order: 0 },
      { id: 3, name: 'Ellen Page', character: 'Ariadne', profile_path: null, order: 1 },
    ],
    crew: [],
  },
  'watch/providers': {
    results: {
      SE: {
        link: 'x',
        flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '' }],
        rent: [{ provider_id: 350, provider_name: 'Apple TV', logo_path: '' }],
        buy: [{ provider_id: 350, provider_name: 'Apple TV', logo_path: '' }],
      },
    },
  },
} as unknown as TMDBMovie;

describe('movieContentFloorInput', () => {
  it('maps the fields the generator needs', () => {
    const input = movieContentFloorInput(movie);
    expect(input.kind).toBe('movie');
    expect(input.title).toBe('Inception');
    expect(input.year).toBe('2010');
    expect(input.genreIds).toEqual([878, 28]);
    expect(input.runtimeMin).toBe(148);
    expect(input.cast).toContain('Leonardo DiCaprio');
    expect(input.providers.stream).toContain('Netflix');
    // canonicalised to the app's official label (id 350 → catalog name)
    expect(input.providers.rent).toContain('Apple TV+');
  });

  it('yields null year when release_date is missing', () => {
    const input = movieContentFloorInput({ ...movie, release_date: '' } as TMDBMovie);
    expect(input.year).toBeNull();
  });

  it('produces an empty provider split when SE data is absent', () => {
    const bare = { ...movie, 'watch/providers': undefined } as TMDBMovie;
    const input = movieContentFloorInput(bare);
    expect(input.providers).toEqual({ stream: [], rent: [], buy: [] });
  });
});

const show = {
  id: 1399,
  name: 'Game of Thrones',
  original_name: 'Game of Thrones',
  overview: '',
  first_air_date: '2011-04-17',
  number_of_seasons: 8,
  genres: [{ id: 18, name: 'Drama' }],
  credits: { cast: [{ id: 1, name: 'Emilia Clarke', character: 'Daenerys', profile_path: null, order: 0 }], crew: [] },
  'watch/providers': {
    results: { SE: { link: 'x', flatrate: [{ provider_id: 384, provider_name: 'HBO Max', logo_path: '' }] } },
  },
} as unknown as TMDBTVShow;

describe('tvContentFloorInput', () => {
  it('maps TV-specific fields (seasons, first_air_date, name)', () => {
    const input = tvContentFloorInput(show);
    expect(input.kind).toBe('tv');
    expect(input.title).toBe('Game of Thrones');
    expect(input.year).toBe('2011');
    expect(input.seasons).toBe(8);
    expect(input.runtimeMin).toBeNull();
    expect(input.genreIds).toEqual([18]);
    // canonicalised: TMDB "HBO Max" (id 384) → app label "Max"
    expect(input.providers.stream).toContain('Max');
  });
});
