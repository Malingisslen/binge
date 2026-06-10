import { describe, it, expect } from 'vitest';
import { computeSessionProviders, libraryExclusionIds, rankCandidates } from './candidates';
import type { SessionCandidate } from '@/types';

function candidate(partial: Partial<SessionCandidate> & { tmdbId: number }): SessionCandidate {
  return {
    mediaType: 'movie',
    title: `Titel ${partial.tmdbId}`,
    posterPath: null,
    year: 2024,
    runtime: null,
    genreIds: [],
    voteAverage: 7,
    overview: '',
    providers: [],
    ...partial,
  };
}

describe('libraryExclusionIds', () => {
  it('exkluderar mina/sedd/avbruten men behåller vill_se', () => {
    const ids = libraryExclusionIds([
      { tmdbId: 1, status: 'mina' },
      { tmdbId: 2, status: 'sedd' },
      { tmdbId: 3, status: 'avbruten' },
      { tmdbId: 4, status: 'vill_se' },
    ]);
    expect(ids.has(1)).toBe(true);
    expect(ids.has(2)).toBe(true);
    expect(ids.has(3)).toBe(true);
    // vill_se är prima sessions-kandidater — den som vill se titeln röstar ja.
    expect(ids.has(4)).toBe(false);
  });

  it('tom lista → tom mängd', () => {
    expect(libraryExclusionIds([]).size).toBe(0);
  });
});

describe('rankCandidates', () => {
  it('filtrerar bort exkluderade tmdbIds', () => {
    const pool = [candidate({ tmdbId: 1 }), candidate({ tmdbId: 2 }), candidate({ tmdbId: 3 })];
    const result = rankCandidates(pool, new Set([2]));
    expect(result.map(c => c.tmdbId)).toEqual([1, 3]);
  });

  it('dedupar på mediaType+tmdbId men låter film och serie med samma id samexistera', () => {
    const pool = [
      candidate({ tmdbId: 1, mediaType: 'movie' }),
      candidate({ tmdbId: 1, mediaType: 'movie' }),
      candidate({ tmdbId: 1, mediaType: 'tv' }),
    ];
    expect(rankCandidates(pool)).toHaveLength(2);
  });

  it('sorterar fallande på voteAverage och cappar till 30', () => {
    const pool = Array.from({ length: 40 }, (_, i) =>
      candidate({ tmdbId: i + 1, voteAverage: i }),
    );
    const result = rankCandidates(pool);
    expect(result).toHaveLength(30);
    expect(result[0].voteAverage).toBe(39);
    expect(result[29].voteAverage).toBe(10);
  });

  it('utan exkluderingsmängd är allt kvar', () => {
    const pool = [candidate({ tmdbId: 1 }), candidate({ tmdbId: 2 })];
    expect(rankCandidates(pool)).toHaveLength(2);
  });
});

describe('computeSessionProviders', () => {
  describe('intersect', () => {
    it('returnerar snittet av allas providers', () => {
      const result = computeSessionProviders(
        [{ providers: [8, 337, 119] }, { providers: [337, 119, 9] }],
        'intersect',
      );
      expect(result.sort((a, b) => a - b)).toEqual([119, 337]);
    });

    it('nollas av en deltagare utan providers (M3)', () => {
      // En deltagare som inte konfigurerat providers gör att inget är tittbart
      // för alla — snittet ska bli tomt, inte partnerns hela lista.
      expect(
        computeSessionProviders([{ providers: [8, 337] }, { providers: [] }], 'intersect'),
      ).toEqual([]);
    });

    it('en enda deltagare → den deltagarens providers', () => {
      expect(
        computeSessionProviders([{ providers: [8, 337] }], 'intersect').sort((a, b) => a - b),
      ).toEqual([8, 337]);
    });

    it('tom deltagarlista → tomt', () => {
      expect(computeSessionProviders([], 'intersect')).toEqual([]);
    });
  });

  describe('union', () => {
    it('slår ihop allas providers utan dubbletter', () => {
      const result = computeSessionProviders(
        [{ providers: [8, 337] }, { providers: [337, 9] }],
        'union',
      );
      expect(result.sort((a, b) => a - b)).toEqual([8, 9, 337]);
    });

    it('ignorerar tomma listor', () => {
      expect(
        computeSessionProviders([{ providers: [8] }, { providers: [] }], 'union').sort((a, b) => a - b),
      ).toEqual([8]);
    });
  });
});
