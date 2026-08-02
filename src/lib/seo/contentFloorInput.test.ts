import { describe, it, expect } from 'vitest';
import { movieContentFloorInput, tvContentFloorInput, personDescriptionInput } from './contentFloorInput';
import type { TMDBMovie, TMDBTVShow, TMDBPerson } from '@/types/tmdb';

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

// BIN-656/686 — the third adapter. It carries the only branching of the three
// (biography default, role/birthYear each conditional), and it is what keeps the
// static /person route and PersonPageClient describing a person identically. A
// silent change here re-opens the near-duplicate meta description on ~1000
// pre-rendered pages, which is exactly what BIN-656 was filed to close.
describe('personDescriptionInput', () => {
  const person = {
    id: 1245,
    name: 'Alicia Vikander',
    biography: 'Svensk skådespelare.',
    birthday: '1988-10-03',
    deathday: null,
    place_of_birth: 'Göteborg, Sverige',
    profile_path: '/x.jpg',
    known_for_department: 'Acting',
  } as unknown as TMDBPerson;

  it('maps the fields buildPersonDescription needs', () => {
    const input = personDescriptionInput(person);
    expect(input.name).toBe('Alicia Vikander');
    expect(input.biography).toBe('Svensk skådespelare.');
    expect(input.role).toBe('Skådespelare');
    expect(input.birthYear).toBe('1988');
    expect(input.birthPlace).toBe('Göteborg, Sverige');
  });

  it('translates the department rather than passing TMDB\'s English through', () => {
    expect(personDescriptionInput({ ...person, known_for_department: 'Directing' } as TMDBPerson).role)
      .toBe('Regi');
  });

  it('leaves role null when TMDB has no department, rather than inventing "Person"', () => {
    // translateDepartment('') would return the placeholder 'Person', which would
    // read as a real role in the description. The adapter must not reach it.
    expect(personDescriptionInput({ ...person, known_for_department: '' } as TMDBPerson).role).toBeNull();
  });

  it('takes the birth YEAR only, and nulls it when the birthday is unknown', () => {
    expect(personDescriptionInput({ ...person, birthday: '1988-10-03' } as TMDBPerson).birthYear).toBe('1988');
    expect(personDescriptionInput({ ...person, birthday: null } as TMDBPerson).birthYear).toBeNull();
  });

  it('defaults a missing biography to empty so the fact-based line is used', () => {
    const input = personDescriptionInput({ ...person, biography: undefined } as unknown as TMDBPerson);
    expect(input.biography).toBe('');
  });

  it('passes a missing birthplace through as null', () => {
    expect(personDescriptionInput({ ...person, place_of_birth: null } as TMDBPerson).birthPlace).toBeNull();
  });
});
