import { describe, it, expect } from 'vitest';
import { COMPANION_GROUPS, companionsFor } from './companions';

// Pure structural invariants — no TMDB I/O. These catch the copy-paste mistakes that
// hand-curation invites (a duplicated id, a film-only group, a missing type). They do
// NOT (and cannot) verify that an id points at the RIGHT title — that is verified once,
// by hand, against TMDB when a group is added (see the file header).

describe('COMPANION_GROUPS invariants', () => {
  it('every (mediaType, id) pair is unique across all groups', () => {
    const keys = COMPANION_GROUPS.flat().map((e) => `${e.mediaType}_${e.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every group has ≥2 members and at least one tv AND one movie', () => {
    for (const group of COMPANION_GROUPS) {
      expect(group.length).toBeGreaterThanOrEqual(2);
      expect(group.some((e) => e.mediaType === 'tv')).toBe(true);
      expect(group.some((e) => e.mediaType === 'movie')).toBe(true);
    }
  });

  it('every entry has a valid mediaType, a positive id, and a non-empty label', () => {
    for (const e of COMPANION_GROUPS.flat()) {
      expect(['movie', 'tv']).toContain(e.mediaType);
      expect(Number.isInteger(e.id)).toBe(true);
      expect(e.id).toBeGreaterThan(0);
      expect(e.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('companionsFor', () => {
  it('returns the other members, excluding the queried title itself', () => {
    const others = companionsFor('tv', 1396); // Breaking Bad
    expect(others.map((e) => e.id)).toEqual([559969]); // El Camino only
    expect(others.some((e) => e.mediaType === 'tv' && e.id === 1396)).toBe(false);
  });

  it('works from the film side too (film → source show + sibling films)', () => {
    const others = companionsFor('movie', 4564); // Sex and the City (2008)
    expect(others.map((e) => `${e.mediaType}_${e.id}`)).toEqual(['tv_105', 'movie_37786']);
  });

  it('preserves the curated (chronological) order of the remaining members', () => {
    const others = companionsFor('tv', 33907); // Downton Abbey (3 films)
    expect(others.map((e) => e.id)).toEqual([535544, 820446, 1289936]);
  });

  it('from any group member, returns exactly the other members (self-excluded)', () => {
    // Sweep over the real data: every entry drops itself and keeps the rest. The
    // BIN-560 mediaType-scoped collision is guarded separately by the unmapped-title
    // case below (companionsFor('movie', 1396) → []) — the curated tv/movie id sets
    // are disjoint, so this sweep alone can't distinguish id-only from scoped filtering.
    for (const group of COMPANION_GROUPS) {
      for (const entry of group) {
        const others = companionsFor(entry.mediaType, entry.id);
        expect(others).toHaveLength(group.length - 1);
        expect(others).not.toContainEqual(entry);
      }
    }
  });

  it('returns an empty array for an unmapped title', () => {
    expect(companionsFor('tv', 99999999)).toEqual([]);
    expect(companionsFor('movie', 1396)).toEqual([]); // BB's id but wrong type → unmapped
  });
});
