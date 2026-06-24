import { describe, it, expect } from 'vitest';
import { summarizeAskBinge } from './askbinge';

describe('summarizeAskBinge', () => {
  it('sums scalar counters and bucket maps across daily docs', () => {
    const out = summarizeAskBinge([
      { searches: 10, zeroResults: 2, lowConfidence: 1, chipRemovals: 3, resultBuckets: { '0': 2, '30+': 8 } },
      { searches: 5, zeroResults: 1, resultBuckets: { '0': 1, '1-9': 4 } },
    ]);
    expect(out.searches).toBe(15);
    expect(out.zeroResults).toBe(3);
    expect(out.lowConfidence).toBe(1);
    expect(out.chipRemovals).toBe(3);
    expect(out.resultBuckets).toEqual({ '0': 3, '1-9': 4, '10-29': 0, '30+': 8 });
    expect(out.days).toBe(2);
  });

  it('ranks the filter combos that strand users (by zero-result count) and excludes never-stranding ones', () => {
    const out = summarizeAskBinge([
      {
        filterCombos: {
          'decade+rating': { searches: 8, zero: 6 },
          genre: { searches: 20, zero: 0 },
          'language+runtime': { searches: 4, zero: 3 },
        },
      },
    ]);
    expect(out.topStrandingFilters).toEqual([
      { filters: 'decade+rating', searches: 8, zero: 6 },
      { filters: 'language+runtime', searches: 4, zero: 3 },
    ]);
  });

  it('merges and ranks removed chips across docs', () => {
    const out = summarizeAskBinge([
      { removedChips: { genreIds: 3, decade: 1 } },
      { removedChips: { genreIds: 2, originalLanguage: 5 } },
    ]);
    // ties (genreIds & originalLanguage both 5) break alphabetically for determinism
    expect(out.topRemovedChips).toEqual([
      { key: 'genreIds', count: 5 },
      { key: 'originalLanguage', count: 5 },
      { key: 'decade', count: 1 },
    ]);
  });

  it('returns a zeroed summary for no docs', () => {
    const out = summarizeAskBinge([]);
    expect(out).toEqual({
      searches: 0, zeroResults: 0, lowConfidence: 0, chipRemovals: 0,
      resultBuckets: { '0': 0, '1-9': 0, '10-29': 0, '30+': 0 },
      topStrandingFilters: [], topRemovedChips: [], days: 0,
    });
  });
});
