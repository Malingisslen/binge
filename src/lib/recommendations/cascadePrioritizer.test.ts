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
  it('cold-start: free-public + trending get emitted (free-first above trending)', () => {
    const rows = prioritizeRows(emptyInput());
    // BIN-175: the free public-service lane is always emitted, scored above trending.
    expect(rows.map(r => r.id.kind)).toEqual(['free-public', 'trending']);
  });

  it('BIN-175: free-public lane is always emitted, even with full personalisation', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 603, mediaType: 'movie', title: 'The Matrix', daysSince: 1 },
      strongSeeds: [{ tmdbId: 603, mediaType: 'movie', rating: 5, title: 'The Matrix', ratedAt: null }],
      dominantGenres: [{ id: 18, count: 5 }],
    };
    const rows = prioritizeRows(inp);
    const free = rows.find(r => r.id.kind === 'free-public');
    expect(free).toBeDefined();
    // Free-first within discovery: above genre-canon + trending...
    const idx = (k: string) => rows.findIndex(r => r.id.kind === k);
    expect(idx('free-public')).toBeLessThan(idx('genre-canon'));
    expect(idx('free-public')).toBeLessThan(idx('trending'));
    // ...but below the personalised latest-fav row.
    expect(idx('latest-fav')).toBeLessThan(idx('free-public'));
  });

  it('emits genre-canon when dominant genres exist', () => {
    const inp = { ...emptyInput(), dominantGenres: [{ id: 18, count: 5 }] };
    const rows = prioritizeRows(inp);
    expect(rows.map(r => r.id.kind).sort()).toEqual(['free-public', 'genre-canon', 'trending']);
  });

  it('places latest-fav (5★ within 30d) at the top with recency-decayed score', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 603, mediaType: 'movie', title: 'The Matrix', daysSince: 3 },
      strongSeeds: [{ tmdbId: 603, mediaType: 'movie', rating: 5, title: 'The Matrix', ratedAt: null }],
    };
    const rows = prioritizeRows(inp);
    expect(rows[0].id.kind).toBe('latest-fav');
    expect(rows[0].score).toBe(97);
    // BIN-106: the latest-fav seed must NOT also produce a duplicate 'similar' row.
    expect(rows.find(r => r.id.kind === 'similar')).toBeUndefined();
  });

  it('BIN-106: latest-fav seed is excluded from similar rows, other seeds still emit', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 603, mediaType: 'movie', title: 'The Matrix', daysSince: 3 },
      strongSeeds: [
        { tmdbId: 603, mediaType: 'movie', rating: 5, title: 'The Matrix', ratedAt: null },
        { tmdbId: 27205, mediaType: 'movie', rating: 5, title: 'Inception', ratedAt: null },
      ],
    };
    const rows = prioritizeRows(inp);
    const similars = rows.filter(r => r.id.kind === 'similar');
    // The duplicate (603) is dropped; Inception (a different seed) still gets a row.
    expect(similars.map(r => r.id.kind === 'similar' && r.id.tmdbId)).toEqual([27205]);
  });

  it('BIN-106: same tmdbId but different mediaType is NOT treated as a duplicate', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 42, mediaType: 'movie', title: 'Same Id Movie', daysSince: 1 },
      strongSeeds: [
        { tmdbId: 42, mediaType: 'tv', rating: 5, title: 'Same Id Show', ratedAt: null },
      ],
    };
    const rows = prioritizeRows(inp);
    const similar = rows.find(r => r.id.kind === 'similar');
    expect(similar?.id.kind === 'similar' && similar.id.tmdbId).toBe(42);
  });

  it('person beats similar at high recurrence', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      strongSeeds: [{ tmdbId: 1, mediaType: 'movie', rating: 5, title: 'Seed A', ratedAt: null }],
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
      tmdbId: i + 1, mediaType: 'movie' as const, rating: 5, title: `Seed ${i + 1}`, ratedAt: null,
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
        { tmdbId: 1, mediaType: 'movie', rating: 4, title: 'Fyran', ratedAt: null },
        { tmdbId: 2, mediaType: 'movie', rating: 5, title: 'Femman', ratedAt: null },
      ],
    };
    const rows = prioritizeRows(inp);
    const similars = rows.filter(r => r.id.kind === 'similar');
    expect(similars[0].label).toBe('Liknar Femman');
  });

  it('R2: similar-row headings include the seed title (no duplicate headings at same rating)', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      strongSeeds: [
        { tmdbId: 1, mediaType: 'tv', rating: 5, title: 'Off Campus', ratedAt: null },
        { tmdbId: 2, mediaType: 'tv', rating: 5, title: 'Silo', ratedAt: null },
      ],
    };
    const labels = prioritizeRows(inp).filter(r => r.id.kind === 'similar').map(r => r.label);
    expect(labels).toContain('Liknar Off Campus');
    expect(labels).toContain('Liknar Silo');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('R4: latest-fav heading names the title instead of a cryptic day count', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 7, mediaType: 'tv', title: 'Off Campus', daysSince: 21 },
    };
    const row = prioritizeRows(inp).find(r => r.id.kind === 'latest-fav');
    expect(row?.label).toBe('Liknar Off Campus — din senaste 5★');
  });
});
