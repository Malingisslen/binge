import { describe, it, expect } from 'vitest';
import { shouldPersistQuery } from './queryClient';

function q(key: unknown[], status: 'success' | 'pending' | 'error' = 'success') {
  return { queryKey: key, state: { status } } as Parameters<typeof shouldPersistQuery>[0];
}

describe('shouldPersistQuery', () => {
  it('persisterar lyckade queries med whitelistade prefix', () => {
    expect(shouldPersistQuery(q(['tv-lite', 123]))).toBe(true);
    expect(shouldPersistQuery(q(['movie-lite', 27205]))).toBe(true);
    expect(shouldPersistQuery(q(['genres-movie']))).toBe(true);
    expect(shouldPersistQuery(q(['trending', 'all', 'week']))).toBe(true);
  });
  it('skippar tunga/fulla detaljsvar, säsonger och sök', () => {
    expect(shouldPersistQuery(q(['tv', 123]))).toBe(false);
    expect(shouldPersistQuery(q(['movie', 27205]))).toBe(false);
    // tv-season dominerade hela 5 MB-budgeten i produktion → ej persisterad.
    expect(shouldPersistQuery(q(['tv-season', 123, 2]))).toBe(false);
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
