import { describe, it, expect } from 'vitest';
import { knownDocIds, mayExist } from './siblingDocs';

describe('knownDocIds / mayExist (COST-2)', () => {
  it('a server-confirmed snapshot lists every doc id, including empty docs', () => {
    const known = knownDocIds({ docs: [{ id: 'tv_1' }, { id: 'movie_2' }], metadata: { fromCache: false } });
    expect(mayExist(known, 'tv_1')).toBe(true);
    expect(mayExist(known, 'movie_2')).toBe(true);
    expect(mayExist(known, 'tv_3')).toBe(false);
  });

  it('a cache-only snapshot is unknown, so every doc may exist', () => {
    const known = knownDocIds({ docs: [], metadata: { fromCache: true } });
    expect(known).toBeNull();
    expect(mayExist(known, 'tv_3')).toBe(true);
  });

  it('a snapshot without metadata is unknown', () => {
    expect(knownDocIds({ docs: [] })).toBeNull();
  });
});
