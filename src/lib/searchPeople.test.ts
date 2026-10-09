import { describe, it, expect } from 'vitest';
import { rankPeople, MAX_PEOPLE_SHOWN } from './searchPeople';
import type { TMDBSearchResult } from '@/types';

const person = (id: number, popularity: number, extra: Partial<TMDBSearchResult> = {}): TMDBSearchResult => ({
  id, media_type: 'person', name: 'Tom Holland', poster_path: null, backdrop_path: null,
  overview: '', vote_average: 0, genre_ids: [], popularity, profile_path: '/p.jpg',
  known_for_department: 'Acting', ...extra,
});

describe('rankPeople', () => {
  it('puts the best-known namesake first and caps the list', () => {
    const out = rankPeople([person(1, 2), person(2, 90), person(3, 5), person(4, 1), person(5, 3)]);
    expect(out.map(p => p.id)).toEqual([2, 3, 5]);
    expect(out).toHaveLength(MAX_PEOPLE_SHOWN);
  });

  it('drops titles and people with neither a photo nor a known role', () => {
    const title = { ...person(9, 99), media_type: 'movie' as const };
    const unknown = person(8, 50, { profile_path: null, known_for_department: undefined });
    expect(rankPeople([title, unknown, person(1, 1)]).map(p => p.id)).toEqual([1]);
  });
});
