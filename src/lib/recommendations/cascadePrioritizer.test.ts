import { describe, it, expect } from 'vitest';
import { prioritizeRows } from './cascadePrioritizer';
import type { CascadeInput } from '@/types';

function emptyInput(): CascadeInput {
  return {
    latestFiveStar: null,
    strongSeeds: [],
    weakSeeds: [],
    recurringPeople: [],
    recurringKeywords: [],
    dominantGenres: [],
    hasMyProviders: false,
    upcomingCount: 0,
  };
}

describe('prioritizeRows', () => {
  it('cold-start: only trending gets emitted', () => {
    const rows = prioritizeRows(emptyInput());
    expect(rows.map(r => r.id.kind)).toEqual(['trending']);
  });

  it('emits genre-canon when dominant genres exist', () => {
    const inp = { ...emptyInput(), dominantGenres: [{ id: 18, count: 5 }] };
    const rows = prioritizeRows(inp);
    expect(rows.map(r => r.id.kind).sort()).toEqual(['genre-canon', 'trending']);
  });

  it('places latest-fav (5★ within 30d) at the top with recency-decayed score', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 603, mediaType: 'movie', daysSince: 3 },
      strongSeeds: [{ tmdbId: 603, mediaType: 'movie', rating: 5, ratedAt: null }],
    };
    const rows = prioritizeRows(inp);
    expect(rows[0].id.kind).toBe('latest-fav');
    expect(rows[0].score).toBe(97);
  });

  it('person beats similar at high recurrence', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      strongSeeds: [{ tmdbId: 1, mediaType: 'movie', rating: 5, ratedAt: null }],
      recurringPeople: [{ id: 100, name: 'A', recurrence: 6, knownFor: 'director' }],
    };
    const rows = prioritizeRows(inp);
    const personIdx = rows.findIndex(r => r.id.kind === 'person');
    const similarIdx = rows.findIndex(r => r.id.kind === 'similar');
    expect(personIdx).toBeGreaterThanOrEqual(0);
    expect(personIdx).toBeLessThan(similarIdx);
  });

  it('emits up to 3 similar rows for top strong seeds', () => {
    const seeds = Array.from({ length: 5 }, (_, i) => ({
      tmdbId: i + 1, mediaType: 'movie' as const, rating: 5, ratedAt: null,
    }));
    const rows = prioritizeRows({ ...emptyInput(), strongSeeds: seeds });
    expect(rows.filter(r => r.id.kind === 'similar').length).toBeLessThanOrEqual(3);
  });

  it('upcoming requires myProviders', () => {
    const noProv = prioritizeRows({ ...emptyInput(), upcomingCount: 5 });
    expect(noProv.find(r => r.id.kind === 'upcoming')).toBeUndefined();
    const withProv = prioritizeRows({ ...emptyInput(), hasMyProviders: true, upcomingCount: 5 });
    expect(withProv.find(r => r.id.kind === 'upcoming')).toBeDefined();
  });

  it('B-jobs win tie-breaks against C-jobs at same score', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      hasMyProviders: true,
      upcomingCount: 10, // score = 40
      dominantGenres: [{ id: 18, count: 1 }], // score = 40
    };
    const rows = prioritizeRows(inp);
    const upcomingIdx = rows.findIndex(r => r.id.kind === 'upcoming');
    const genreIdx = rows.findIndex(r => r.id.kind === 'genre-canon');
    expect(upcomingIdx).toBeLessThan(genreIdx);
  });

  it('sorts similar rows in seed-rating order (5★ before 4★)', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      strongSeeds: [
        { tmdbId: 1, mediaType: 'movie', rating: 4, ratedAt: null },
        { tmdbId: 2, mediaType: 'movie', rating: 5, ratedAt: null },
      ],
    };
    const rows = prioritizeRows(inp);
    const similars = rows.filter(r => r.id.kind === 'similar');
    expect(similars[0].label).toBe('Liknar dina 5★');
  });
});
