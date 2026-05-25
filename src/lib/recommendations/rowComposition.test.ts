import { describe, it, expect } from 'vitest';
import {
  dedupeAndExclude,
  splitVisibleAndPool,
  applyClientFilters,
  scoreSimilarity,
  containsSearchText,
  rotatePool,
} from './rowComposition';
import type { RowTitle, FilterState } from '@/types';

function mkTitle(overrides: Partial<RowTitle> = {}): RowTitle {
  return {
    id: 1,
    title: 'X',
    poster_path: null,
    backdrop_path: null,
    media_type: 'movie',
    release_date: '2020-01-01',
    vote_average: 7.5,
    vote_count: 1000,
    genre_ids: [18],
    origin_country: ['SE'],
    original_title: 'X',
    overview: '',
    ...overrides,
  } as RowTitle;
}

describe('dedupeAndExclude', () => {
  it('drops duplicates and excluded ids', () => {
    const items = [mkTitle({ id: 1 }), mkTitle({ id: 2 }), mkTitle({ id: 1 }), mkTitle({ id: 3 })];
    expect(dedupeAndExclude(items, new Set([3])).map(t => t.id)).toEqual([1, 2]);
  });

  it('treats movie/tv with same id as distinct', () => {
    const items = [mkTitle({ id: 5, media_type: 'movie' }), mkTitle({ id: 5, media_type: 'tv' })];
    expect(dedupeAndExclude(items, new Set())).toHaveLength(2);
  });
});

describe('splitVisibleAndPool', () => {
  it('returns first cap as visible, rest as backing pool', () => {
    const items = Array.from({ length: 30 }, (_, i) => mkTitle({ id: i + 1 }));
    const { visible, backingPool } = splitVisibleAndPool(items, 20);
    expect(visible).toHaveLength(20);
    expect(backingPool).toHaveLength(10);
  });

  it('handles short input', () => {
    const { visible, backingPool } = splitVisibleAndPool([mkTitle({ id: 1 })], 20);
    expect(visible).toHaveLength(1);
    expect(backingPool).toHaveLength(0);
  });
});

describe('applyClientFilters', () => {
  const base: FilterState = {
    mediaType: 'all', genre: '', country: '', myProvidersOnly: false, decade: '', voteAverageMin: 0, searchText: '',
    hideNonLatinTitles: false, hiddenCountries: [],
  };

  it('filters by hideNonLatinTitles when set', () => {
    const items = [
      mkTitle({ id: 1, title: 'Parasite', original_title: '기생충' }),
      mkTitle({ id: 2, title: 'Memento', original_title: 'Memento' }),
    ];
    expect(applyClientFilters(items, { ...base, hideNonLatinTitles: true }).map(t => t.id)).toEqual([2]);
  });

  it('filters by hiddenCountries (origin_country fully matches)', () => {
    const items = [
      mkTitle({ id: 1, origin_country: ['IN'] }),
      mkTitle({ id: 2, origin_country: ['SE', 'IN'] }),
      mkTitle({ id: 3, origin_country: ['SE'] }),
    ];
    // hide IN: only id 1 is fully IN; id 2 has SE+IN so survives
    expect(applyClientFilters(items, { ...base, hiddenCountries: ['IN'] }).map(t => t.id)).toEqual([2, 3]);
  });

  it('filters by mediaType', () => {
    const items = [
      mkTitle({ id: 1, media_type: 'movie' }),
      mkTitle({ id: 2, media_type: 'tv' }),
    ];
    expect(applyClientFilters(items, { ...base, mediaType: 'movie' }).map(t => t.id)).toEqual([1]);
    expect(applyClientFilters(items, { ...base, mediaType: 'tv' }).map(t => t.id)).toEqual([2]);
    expect(applyClientFilters(items, { ...base, mediaType: 'all' }).map(t => t.id)).toEqual([1, 2]);
  });

  it('filters by decade', () => {
    const items = [
      mkTitle({ id: 1, release_date: '1985-06-01' }),
      mkTitle({ id: 2, release_date: '2005-06-01' }),
      mkTitle({ id: 3, release_date: '1979-12-31' }),
    ];
    expect(applyClientFilters(items, { ...base, decade: '1980' }).map(t => t.id)).toEqual([1]);
  });

  it('filters by voteAverageMin', () => {
    const items = [
      mkTitle({ id: 1, vote_average: 6.0 }),
      mkTitle({ id: 2, vote_average: 7.5 }),
      mkTitle({ id: 3, vote_average: 8.2 }),
    ];
    expect(applyClientFilters(items, { ...base, voteAverageMin: 7.5 }).map(t => t.id)).toEqual([2, 3]);
  });

  it('filters by country', () => {
    const items = [
      mkTitle({ id: 1, origin_country: ['SE'] }),
      mkTitle({ id: 2, origin_country: ['US'] }),
      mkTitle({ id: 3, origin_country: ['SE', 'NO'] }),
    ];
    expect(applyClientFilters(items, { ...base, country: 'SE' }).map(t => t.id)).toEqual([1, 3]);
  });

  it('filters by genre', () => {
    const items = [mkTitle({ id: 1, genre_ids: [18, 53] }), mkTitle({ id: 2, genre_ids: [28] })];
    expect(applyClientFilters(items, { ...base, genre: '53' }).map(t => t.id)).toEqual([1]);
  });

  it('filters by search text on title or original_title', () => {
    const items = [
      mkTitle({ id: 1, title: 'Parasite', original_title: 'Gisaengchung' }),
      mkTitle({ id: 2, title: 'Snowpiercer', original_title: 'Snowpiercer' }),
    ];
    expect(applyClientFilters(items, { ...base, searchText: 'gisaeng' }).map(t => t.id)).toEqual([1]);
  });
});

describe('scoreSimilarity', () => {
  it('weights TMDB position higher (lower index = higher score)', () => {
    expect(scoreSimilarity(0, 'recommendations')).toBeGreaterThan(scoreSimilarity(10, 'recommendations'));
  });

  it('boosts /recommendations over /similar at same index', () => {
    expect(scoreSimilarity(0, 'recommendations')).toBeGreaterThan(scoreSimilarity(0, 'similar'));
  });
});

describe('rotatePool', () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('returns first window for seed 0', () => {
    expect(rotatePool(arr, 0, 3)).toEqual([1, 2, 3]);
  });

  it('advances by take each seed step', () => {
    expect(rotatePool(arr, 1, 3)).toEqual([4, 5, 6]);
    expect(rotatePool(arr, 2, 3)).toEqual([7, 8, 9]);
  });

  it('wraps around when window crosses the end', () => {
    expect(rotatePool(arr, 3, 3)).toEqual([10, 1, 2]);
  });

  it('wraps fully when seed exceeds pool divisions', () => {
    // seed 4 with take 3 → offset 12 % 10 = 2 → [3, 4, 5]
    expect(rotatePool(arr, 4, 3)).toEqual([3, 4, 5]);
  });

  it('returns full array when pool is smaller than take', () => {
    expect(rotatePool([1, 2], 5, 6)).toEqual([1, 2]);
  });

  it('handles empty input', () => {
    expect(rotatePool<number>([], 3, 6)).toEqual([]);
  });

  it('handles negative seeds (defensive)', () => {
    // -1 * 3 = -3, mod 10 with positive-shift = 7 → [8, 9, 10]
    expect(rotatePool(arr, -1, 3)).toEqual([8, 9, 10]);
  });
});

describe('containsSearchText', () => {
  it('handles diacritics and case', () => {
    expect(containsSearchText('Den blomstertid', 'Den blomstertid', 'BLOMSTER')).toBe(true);
    expect(containsSearchText('Mörk', null, 'mork')).toBe(true);
  });

  it('returns true for empty query', () => {
    expect(containsSearchText('anything', null, '')).toBe(true);
  });
});
