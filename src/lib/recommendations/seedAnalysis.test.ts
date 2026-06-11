import { describe, it, expect } from 'vitest';
import {
  classifySeeds,
  detectLatestFiveStar,
  detectRecurringPeople,
  detectRecurringKeywords,
  detectDominantGenres,
} from './seedAnalysis';
import type { WatchlistItem, Seed } from '@/types';

function mkItem(overrides: Partial<WatchlistItem>): WatchlistItem {
  return {
    tmdbId: 1,
    mediaType: 'movie',
    status: 'sedd',
    rating: null,
    notes: null,
    title: 'Test',
    posterPath: null,
    releaseYear: 2020,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    dropped: false,
    rewatchCount: 0,
    providers: [],
    providersCheckedAt: null,
    visibility: null,
    genreIds: [18],
    tmdbStatus: null,
    addedAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    watchedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function mkSeed(overrides: Partial<Seed> & Pick<Seed, 'tmdbId'>): Seed {
  return { mediaType: 'movie', rating: 5, title: 'Test', ratedAt: null, ...overrides };
}

describe('classifySeeds', () => {
  it('classifies 5★/4★ as strong, 3★ as weak, omits the rest', () => {
    const items = [
      mkItem({ tmdbId: 1, rating: 5 }),
      mkItem({ tmdbId: 2, rating: 4 }),
      mkItem({ tmdbId: 3, rating: 3 }),
      mkItem({ tmdbId: 4, rating: 2 }),
      mkItem({ tmdbId: 5, rating: null }),
      mkItem({ tmdbId: 6, rating: 5, status: 'avbruten' }),
      mkItem({ tmdbId: 7, rating: 5, status: 'vill_se' }),
    ];
    const { strong, weak } = classifySeeds(items);
    expect(strong.map(s => s.tmdbId).sort()).toEqual([1, 2]);
    expect(weak.map(s => s.tmdbId).sort()).toEqual([3]);
  });

  it('passes ratedAt from updatedAt', () => {
    const d = new Date('2026-04-20');
    const items = [mkItem({ tmdbId: 10, rating: 5, updatedAt: d })];
    expect(classifySeeds(items).strong[0].ratedAt?.getTime()).toBe(d.getTime());
  });

  it('accepts both sedd and mina status', () => {
    const items = [
      mkItem({ tmdbId: 1, rating: 5, status: 'sedd' }),
      mkItem({ tmdbId: 2, rating: 5, status: 'mina' }),
    ];
    expect(classifySeeds(items).strong.map(s => s.tmdbId).sort()).toEqual([1, 2]);
  });
});

describe('detectLatestFiveStar', () => {
  const today = new Date('2026-04-25T12:00:00Z');

  it('returns the most recent 5★ within window', () => {
    const items = [
      mkItem({ tmdbId: 1, rating: 5, updatedAt: new Date('2026-04-22T12:00:00Z') }),
      mkItem({ tmdbId: 2, rating: 5, updatedAt: new Date('2026-04-10T12:00:00Z') }),
      mkItem({ tmdbId: 3, rating: 4, updatedAt: new Date('2026-04-24T12:00:00Z') }),
    ];
    const r = detectLatestFiveStar(items, today, 30);
    expect(r?.tmdbId).toBe(1);
    expect(r?.daysSince).toBe(3);
  });

  it('returns null when no 5★ within window', () => {
    expect(detectLatestFiveStar([mkItem({ tmdbId: 1, rating: 5, updatedAt: new Date('2026-01-01') })], today, 30)).toBeNull();
  });

  it('returns null when nothing has 5★', () => {
    expect(detectLatestFiveStar([mkItem({ tmdbId: 1, rating: 4 })], today, 30)).toBeNull();
  });

  it('ignores 5★ on avbruten or vill_se status', () => {
    const items = [
      mkItem({ tmdbId: 1, rating: 5, status: 'avbruten', updatedAt: new Date('2026-04-23') }),
      mkItem({ tmdbId: 2, rating: 5, status: 'vill_se', updatedAt: new Date('2026-04-24') }),
    ];
    expect(detectLatestFiveStar(items, today, 30)).toBeNull();
  });
});

describe('detectRecurringPeople', () => {
  it('returns persons appearing in ≥3 strong seeds', () => {
    const seeds = [mkSeed({ tmdbId: 1 }), mkSeed({ tmdbId: 2, rating: 4 }), mkSeed({ tmdbId: 3 }), mkSeed({ tmdbId: 4 })];
    const credits = new Map([
      [1, { cast: [{ id: 100, name: 'Bong' }, { id: 200, name: 'Other' }], director: { id: 100, name: 'Bong' } }],
      [2, { cast: [{ id: 100, name: 'Bong' }], director: null }],
      [3, { cast: [{ id: 100, name: 'Bong' }], director: { id: 300, name: 'Director3' } }],
      [4, { cast: [{ id: 200, name: 'Other' }], director: null }],
    ]);
    const people = detectRecurringPeople(seeds, credits, 3);
    expect(people).toHaveLength(1);
    expect(people[0].id).toBe(100);
    expect(people[0].recurrence).toBe(3);
  });

  it('returns empty when threshold not met', () => {
    expect(detectRecurringPeople([mkSeed({ tmdbId: 1 })], new Map([[1, { cast: [{ id: 100, name: 'X' }], director: null }]]), 3)).toEqual([]);
  });

  it('caps at top 5 by recurrence', () => {
    const seeds = Array.from({ length: 6 }, (_, i) => mkSeed({ tmdbId: i + 1 }));
    const credits = new Map(seeds.map(s => [s.tmdbId, {
      cast: [
        { id: 100, name: 'A' }, { id: 200, name: 'B' }, { id: 300, name: 'C' },
        { id: 400, name: 'D' }, { id: 500, name: 'E' }, { id: 600, name: 'F' },
      ],
      director: null,
    }]));
    expect(detectRecurringPeople(seeds, credits, 3)).toHaveLength(5);
  });

  it('director gets tie-break priority over cast at same recurrence', () => {
    const seeds = [mkSeed({ tmdbId: 1 }), mkSeed({ tmdbId: 2 }), mkSeed({ tmdbId: 3 })];
    const credits = new Map([
      [1, { cast: [{ id: 100, name: 'CastOnly' }], director: { id: 200, name: 'Dir' } }],
      [2, { cast: [{ id: 100, name: 'CastOnly' }], director: { id: 200, name: 'Dir' } }],
      [3, { cast: [{ id: 100, name: 'CastOnly' }], director: { id: 200, name: 'Dir' } }],
    ]);
    const people = detectRecurringPeople(seeds, credits, 3);
    expect(people[0].id).toBe(200);
    expect(people[0].knownFor).toBe('director');
  });
});

describe('detectRecurringKeywords', () => {
  it('returns keywords in ≥3 distinct titles', () => {
    const seeds = [1, 2, 3, 4].map(id => mkSeed({ tmdbId: id, rating: id <= 2 ? 5 : 3 }));
    const keywords = new Map([
      [1, [{ id: 10, name: 'cult-classic' }, { id: 20, name: 'small-town' }]],
      [2, [{ id: 10, name: 'cult-classic' }]],
      [3, [{ id: 10, name: 'cult-classic' }, { id: 20, name: 'small-town' }]],
      [4, [{ id: 20, name: 'small-town' }]],
    ]);
    const r = detectRecurringKeywords(seeds, keywords, 3);
    expect(r.map(k => k.id)).toContain(10);
  });

  it('caps at 3 keyword rows', () => {
    const seeds = Array.from({ length: 4 }, (_, i) => mkSeed({ tmdbId: i + 1 }));
    const keywords = new Map(seeds.map(s => [s.tmdbId, [
      { id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' },
      { id: 4, name: 'd' }, { id: 5, name: 'e' },
    ]]));
    expect(detectRecurringKeywords(seeds, keywords, 3)).toHaveLength(3);
  });
});

describe('detectDominantGenres', () => {
  it('returns top genres by occurrence in 3-5★ seeds', () => {
    const items = [
      mkItem({ tmdbId: 1, rating: 5, genreIds: [18, 53] }),
      mkItem({ tmdbId: 2, rating: 4, genreIds: [18] }),
      mkItem({ tmdbId: 3, rating: 3, genreIds: [18, 80] }),
      mkItem({ tmdbId: 4, rating: 5, genreIds: [53] }),
    ];
    const r = detectDominantGenres(items, 5);
    expect(r[0].id).toBe(18);
    expect(r[0].count).toBe(3);
    expect(r[1].id).toBe(53);
  });

  it('caps result count', () => {
    const items = [1, 2, 3, 4, 5, 6, 7].map(id => mkItem({ tmdbId: id, rating: 5, genreIds: [id * 10] }));
    expect(detectDominantGenres(items, 3)).toHaveLength(3);
  });

  it('ignores rating < 3 and avbruten/vill_se', () => {
    const items = [
      mkItem({ tmdbId: 1, rating: 2, genreIds: [18] }),
      mkItem({ tmdbId: 2, rating: 5, status: 'avbruten', genreIds: [18] }),
    ];
    expect(detectDominantGenres(items, 5)).toEqual([]);
  });
});
