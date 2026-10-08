import { describe, it, expect } from 'vitest';
import { keepOnServices, refineTitles, sortRowTitles, NO_REFINEMENT } from './refineTitles';
import type { TMDBProviderData } from '@/types/tmdb';
import type { RowTitle } from '@/types';

const NETFLIX = 8;
const MAX = 1899;
const VIAPLAY = 76;
const offer = (provider_id: number) => ({ provider_id, provider_name: '', logo_path: '', display_priority: 0 });
const title = (id: number) => ({ id, media_type: 'movie' });

describe('keepOnServices', () => {
  const providers: Record<string, TMDBProviderData> = {
    'movie-1': { link: '', flatrate: [offer(NETFLIX)] },
    'movie-2': { link: '', flatrate: [offer(MAX)] },
    'movie-3': { link: '', rent: [offer(NETFLIX)] },
    'movie-4': { link: '', ads: [offer(NETFLIX)] },
    'movie-5': { link: '', free: [offer(VIAPLAY)] },
  };

  it('behåller bara titlar som går att se på en av tjänsterna', () => {
    const kept = keepOnServices([title(1), title(2), title(3), title(4)], providers, [NETFLIX]);
    expect(kept.map(t => t.id)).toEqual([1, 4]);
  });

  it('flera tjänster gäller med "eller"', () => {
    const kept = keepOnServices([title(1), title(2), title(5)], providers, [MAX, VIAPLAY]);
    expect(kept.map(t => t.id)).toEqual([2, 5]);
  });

  it('räknar inte hyra eller köp', () => {
    expect(keepOnServices([title(3)], providers, [NETFLIX])).toEqual([]);
  });

  it('lämnar bort en titel vars tjänster inte hämtats än', () => {
    expect(keepOnServices([title(9)], providers, [NETFLIX])).toEqual([]);
  });

  it('skiljer film och serie med samma id', () => {
    expect(keepOnServices([{ id: 1, media_type: 'tv' }], providers, [NETFLIX])).toEqual([]);
  });

  it('jämför kanoniska id på båda sidor (TV4 Play 489 och aliaset 1944)', () => {
    const p: Record<string, TMDBProviderData> = { 'movie-1': { link: '', flatrate: [offer(1944)] } };
    expect(keepOnServices([title(1)], p, [489]).map(t => t.id)).toEqual([1]);
    const q: Record<string, TMDBProviderData> = { 'movie-1': { link: '', flatrate: [offer(489)] } };
    expect(keepOnServices([title(1)], q, [1944]).map(t => t.id)).toEqual([1]);
  });
});

const rt = (o: Partial<RowTitle>): RowTitle => ({
  id: 1, title: 'X', poster_path: null, backdrop_path: null, media_type: 'movie',
  overview: '', vote_average: 0, genre_ids: [], ...o,
} as RowTitle);

describe('sortRowTitles', () => {
  const items = [
    rt({ id: 1, vote_average: 7, vote_count: 50, release_date: '2001-01-01' }),
    rt({ id: 2, vote_average: 8, vote_count: 10, release_date: '1999-01-01' }),
    rt({ id: 3, vote_average: 7, vote_count: 900, release_date: '2020-01-01' }),
  ];

  it('Relevans är exakt dagens ordning', () => {
    expect(sortRowTitles(items, 'relevance')).toBe(items);
  });

  it('Betyg sorterar fallande och bryter lika på antal röster', () => {
    expect(sortRowTitles(items, 'rating').map(t => t.id)).toEqual([2, 3, 1]);
  });

  it('Premiärdatum visar nyast först och läser seriens första sändning', () => {
    const tv = rt({ id: 4, media_type: 'tv', release_date: undefined, first_air_date: '2024-05-01' } as Partial<RowTitle>);
    expect(sortRowTitles([...items, tv], 'release').map(t => t.id)).toEqual([4, 3, 1, 2]);
  });
});

describe('refineTitles', () => {
  const film80 = rt({ id: 1 });
  const film150 = rt({ id: 2 });
  const shortSeries = rt({ id: 3, media_type: 'tv' });
  const noRuntime = rt({ id: 4 });
  const runtimeByKey = { 'movie-1': 80, 'movie-2': 150, 'tv-3': 22 };

  it('utan förfining lämnas listan orörd', () => {
    const items = [film80, film150];
    expect(refineTitles(items, { providersByKey: {}, runtimeByKey: {} }, NO_REFINEMENT)).toBe(items);
  });

  it('Längd behåller det som ryms och tappar titlar utan känd speltid', () => {
    const items = [film80, film150, shortSeries, noRuntime];
    const facts = { providersByKey: {}, runtimeByKey };
    expect(refineTitles(items, facts, { ...NO_REFINEMENT, length: 'film-90' }).map(t => t.id)).toEqual([1]);
    expect(refineTitles(items, facts, { ...NO_REFINEMENT, length: 'short-episodes' }).map(t => t.id)).toEqual([3]);
  });

  it('en förfining som tömmer poolen ger en tom lista, inte ett fel', () => {
    expect(refineTitles([film150], { providersByKey: {}, runtimeByKey }, { ...NO_REFINEMENT, length: 'film-90' })).toEqual([]);
  });
});
