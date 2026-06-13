import { describe, it, expect } from 'vitest';
import { shouldPersistQuery } from './queryClient';

function q(key: unknown[], status: 'success' | 'pending' | 'error' = 'success') {
  return { queryKey: key, state: { status } } as Parameters<typeof shouldPersistQuery>[0];
}

describe('shouldPersistQuery', () => {
  it('persisterar små delade katalog-queryer', () => {
    expect(shouldPersistQuery(q(['genres-movie']))).toBe(true);
    expect(shouldPersistQuery(q(['genres-tv']))).toBe(true);
    expect(shouldPersistQuery(q(['trending', 'all', 'week']))).toBe(true);
    expect(shouldPersistQuery(q(['popular-movies', 1]))).toBe(true);
    expect(shouldPersistQuery(q(['discover-tv', {}]))).toBe(true);
  });
  it('persisterar ALDRIG per-titel-data (skalar med bibliotek, spränger 5 MB)', () => {
    // tv-lite fyllde ensamt hela 5 MB-taket på ett 222-titlars bibliotek
    // (mätt i produktion) — precis som tv-season före det. Per-titel-svar
    // hör inte hemma i localStorage-budgeten.
    expect(shouldPersistQuery(q(['tv-lite', 123]))).toBe(false);
    expect(shouldPersistQuery(q(['movie-lite', 27205]))).toBe(false);
    expect(shouldPersistQuery(q(['tv-season', 123, 2]))).toBe(false);
    // watch-providers är också per-titel (multi-country, ~40 KB/titel) —
    // stod för 1396 av 1409 KB i produktion efter att tv-lite togs bort.
    expect(shouldPersistQuery(q(['watch-providers', 'tv', 123]))).toBe(false);
  });
  it('skippar tunga/fulla detaljsvar och sök', () => {
    expect(shouldPersistQuery(q(['tv', 123]))).toBe(false);
    expect(shouldPersistQuery(q(['movie', 27205]))).toBe(false);
    expect(shouldPersistQuery(q(['search', 'dune', 1]))).toBe(false);
  });
  it('skippar queries som inte lyckats', () => {
    expect(shouldPersistQuery(q(['tv-lite', 123], 'pending'))).toBe(false);
    expect(shouldPersistQuery(q(['tv-lite', 123], 'error'))).toBe(false);
  });
  it('skippar icke-sträng-nycklar defensivt', () => {
    expect(shouldPersistQuery(q([42]))).toBe(false);
  });
});
