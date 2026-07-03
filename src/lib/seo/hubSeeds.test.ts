import { describe, it, expect } from 'vitest';
import { seedHubItems } from './hubSeeds';
import type { TMDBSearchResult } from '@/types';

function item(over: Partial<TMDBSearchResult>): TMDBSearchResult {
  return {
    id: 1,
    media_type: 'movie',
    title: 'Alpha',
    original_title: 'Alpha',
    poster_path: null,
    backdrop_path: null,
    overview: '',
    vote_average: 7,
    genre_ids: [],
    ...over,
  } as TMDBSearchResult;
}

describe('seedHubItems — build-time hub grid curation', () => {
  it('returns [] for undefined results (TMDB hick / CI dummy key)', () => {
    expect(seedHubItems(undefined)).toEqual([]);
  });

  it('stamps media_type when the endpoint omits it (popular lists)', () => {
    const raw = { ...item({ id: 5 }), media_type: undefined } as unknown as TMDBSearchResult;
    const out = seedHubItems([raw], { mediaType: 'movie' });
    expect(out).toHaveLength(1);
    expect(out[0].media_type).toBe('movie');
  });

  it('drops person results (trending/all includes them)', () => {
    const person = item({ id: 9, media_type: 'person', name: 'Zendaya', title: undefined });
    const movie = item({ id: 10 });
    expect(seedHubItems([person, movie]).map(i => i.id)).toEqual([10]);
  });

  it('drops titles with a non-Latin display title', () => {
    const cjk = item({ id: 11, title: '侠岚', original_title: '侠岚' });
    expect(seedHubItems([cjk])).toEqual([]);
  });

  it('drops Latin-display titles whose ORIGINAL is non-Latin (stricter than latinDisplayIds — matches home browsing behavior)', () => {
    const parasite = item({ id: 12, title: 'Parasite', original_title: '기생충' });
    expect(seedHubItems([parasite])).toEqual([]);
  });

  it('reads TV name/original_name shape', () => {
    const tv = item({ id: 13, media_type: 'tv', title: undefined, original_title: undefined, name: 'Bron', original_name: 'Bron' });
    const kdrama = item({ id: 14, media_type: 'tv', title: undefined, original_title: undefined, name: 'Squid Game', original_name: '오징어 게임' });
    expect(seedHubItems([tv, kdrama]).map(i => i.id)).toEqual([13]);
  });

  it('caps to the limit (default 20) preserving order', () => {
    const many = Array.from({ length: 30 }, (_, i) => item({ id: i + 1, title: `T${i + 1}`, original_title: `T${i + 1}` }));
    const out = seedHubItems(many);
    expect(out).toHaveLength(20);
    expect(out[0].id).toBe(1);
    const five = seedHubItems(many, { limit: 5 });
    expect(five.map(i => i.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
