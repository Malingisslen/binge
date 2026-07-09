import { describe, it, expect } from 'vitest';
import { prunePersonSeed } from './personSeed';
import type { TMDBPerson, TMDBSearchResult } from '@/types';

type Credit = TMDBSearchResult & { character?: string; job?: string };

function credit(over: Partial<Credit> = {}): Credit {
  return {
    id: 1,
    media_type: 'movie',
    title: 'A Film',
    name: undefined,
    original_title: 'Original A',
    original_name: undefined,
    poster_path: '/a.jpg',
    backdrop_path: '/backdrop.jpg',
    overview: 'A long overview that should be dropped from the seed.',
    vote_average: 7.5,
    vote_count: 1000,
    genre_ids: [28, 12],
    release_date: '2020-01-01',
    ...over,
  };
}

function person(over: Partial<TMDBPerson> = {}): TMDBPerson {
  return {
    id: 42,
    name: 'Jane Doe',
    biography: 'bio',
    birthday: '1980-01-01',
    deathday: null,
    place_of_birth: 'Stockholm',
    profile_path: '/p.jpg',
    known_for_department: 'Acting',
    ...over,
  };
}

describe('prunePersonSeed', () => {
  it('passes an old-shape person (no combined_credits) through unchanged', () => {
    const p = person();
    expect(prunePersonSeed(p)).toBe(p);
  });

  it('drops fat fields but keeps every field the filmography renders', () => {
    const out = prunePersonSeed(
      person({ combined_credits: { cast: [credit({ character: 'Hero' })], crew: [] } }),
    );
    const c = out.combined_credits!.cast[0];
    // Dropped (bulk of the bytes):
    expect(c.overview).toBe('');
    expect(c.backdrop_path).toBeNull();
    // Kept (consumed by TitleCard / getDisplayTitle / duotone / sort):
    expect(c.id).toBe(1);
    expect(c.media_type).toBe('movie');
    expect(c.title).toBe('A Film');
    expect(c.original_title).toBe('Original A');
    expect(c.poster_path).toBe('/a.jpg');
    expect(c.genre_ids).toEqual([28, 12]);
    expect(c.release_date).toBe('2020-01-01');
    expect(c.vote_average).toBe(7.5);
    expect(c.character).toBe('Hero');
    // The helper's whole purpose: fat fields are dropped via an explicit
    // allowlist, not merely emptied. Assert key-ABSENCE so a regression to
    // `{ ...c, overview:'', backdrop_path:null }` (spread) — which would re-leak
    // vote_count/popularity/credit_id and re-bloat ~1000 static pages — fails.
    expect('vote_count' in c).toBe(false);
  });

  it('preserves TV display fields (name / original_name / first_air_date)', () => {
    // A movie fixture leaves name/original_name/first_air_date undefined, so a
    // TV credit is the only thing that pins getDisplayTitle's name-fallback and
    // getReleaseYear's first_air_date branch.
    const tv = credit({
      id: 7,
      media_type: 'tv',
      title: undefined,
      original_title: undefined,
      name: 'A Show',
      original_name: 'Original Show',
      release_date: undefined,
      first_air_date: '2019-05-05',
    });
    const out = prunePersonSeed(person({ combined_credits: { cast: [tv], crew: [] } }));
    const c = out.combined_credits!.cast[0];
    expect(c.name).toBe('A Show');
    expect(c.original_name).toBe('Original Show');
    expect(c.first_air_date).toBe('2019-05-05');
  });

  it('keeps crew job for the Director/Creator filter + directed-meter', () => {
    const out = prunePersonSeed(
      person({ combined_credits: { cast: [], crew: [credit({ id: 9, character: undefined })] } }),
    );
    const out2 = prunePersonSeed(
      person({ combined_credits: { cast: [], crew: [{ ...credit({ id: 9 }), job: 'Director' }] } }),
    );
    expect(out.combined_credits!.crew).toHaveLength(1);
    expect(out2.combined_credits!.crew[0].job).toBe('Director');
  });

  it('defaults vote_average to 0 and genre_ids to [] so TitleCard never crashes', () => {
    // Simulate a malformed TMDB credit that omits vote_average / genre_ids —
    // the type says they are required, but real API rows sometimes drop them,
    // and TitleCard calls `vote_average.toFixed(1)`.
    const malformed = {
      id: 3,
      media_type: 'movie',
      title: 'No Votes',
      poster_path: null,
      backdrop_path: null,
      overview: '',
    } as unknown as TMDBSearchResult;
    const out = prunePersonSeed(
      person({ combined_credits: { cast: [malformed], crew: [] } }),
    );
    const c = out.combined_credits!.cast[0];
    expect(c.vote_average).toBe(0);
    expect(c.genre_ids).toEqual([]);
  });

  it('keeps every cast row — prunes fields, never drops credits', () => {
    // No row-cap by design: the page reuses this seed and skips the full
    // /combined_credits fetch, so dropping rows here would hide films from the
    // user (a vote_average cap would drop the newest un-voted titles — exactly
    // what a visitor looks for). Pruning is fields-only.
    // vote_average ascending → id=0 is the lowest-rated ("newest un-voted")
    // row, exactly what a vote_average cap would have sliced out first.
    const many = Array.from({ length: 250 }, (_, i) => credit({ id: i, vote_average: i }));
    const out = prunePersonSeed(person({ combined_credits: { cast: many, crew: [] } }));
    expect(out.combined_credits!.cast).toHaveLength(250);
    // Pin the exact regression: the lowest-vote row must survive.
    expect(out.combined_credits!.cast.some(c => c.id === 0)).toBe(true);
  });
});
