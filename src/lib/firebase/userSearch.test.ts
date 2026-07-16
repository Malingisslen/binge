import { describe, it, expect, vi, beforeEach } from 'vitest';

const getDocsMock = vi.fn();
const getDocMock = vi.fn();
const queryMock = vi.fn();
const whereMock = vi.fn((field: unknown, op: unknown, value: unknown) => ({ _where: [field, op, value] }));

// BIN-505: mock fsdb() with INLINE functions — NOT a spread of a dynamically
// import()ed firebase/firestore. The old dynamic-import spread RACED under the
// Promise.all projection fan-out: one concurrent getPublicProfileCard resolved
// the REAL unmocked getDoc, which crashed on the fake {_path} ref and dropped
// that branch — making a 2-candidate visibility assertion pass for the WRONG
// reason (proven by the test-reviewer's mutation test, 2026-07-14). Inline fns
// are deterministic, so the visibility gate is genuinely exercised.
vi.mock('./db', () => ({
  fsdb: async () => ({
    db: {},
    collection: (_db: unknown, name: string) => ({ _name: name }),
    doc: (_db: unknown, name: string, id: string) => ({ _path: `${name}/${id}` }),
    getDoc: getDocMock,
    getDocs: getDocsMock,
    query: queryMock,
    where: whereMock,
    limit: (n: unknown) => ({ _limit: n }),
    orderBy: (field: unknown) => ({ _orderBy: field }),
    documentId: () => '__name__',
  }),
}));

import { searchUsersByPrefix } from './userSearch';

beforeEach(() => {
  getDocsMock.mockReset();
  getDocMock.mockReset();
  queryMock.mockClear();
  whereMock.mockClear();
});

describe('searchUsersByPrefix', () => {
  it('returnerar tom lista för query under 2 tecken', async () => {
    expect(await searchUsersByPrefix('')).toEqual([]);
    expect(await searchUsersByPrefix('a')).toEqual([]);
    expect(await searchUsersByPrefix(' ')).toEqual([]);
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('strippar @-prefix och normaliserar till lowercase', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    await searchUsersByPrefix('@MaLin');

    // Verifiera att queryn skickade in lowercase utan @
    expect(queryMock.mock.calls.length).toBeGreaterThan(0);
    const lowerCalls = whereMock.mock.calls.filter(c => c[1] === '>=');
    expect(lowerCalls[lowerCalls.length - 1][2]).toBe('malin');
  });

  it('returnerar tom lista när usernames-collection är tom', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    expect(await searchUsersByPrefix('foo')).toEqual([]);
  });

  // BIN-505: visibility is now enforced by firestore.rules on the publicProfiles
  // projection — getPublicProfileCard returns null when the read is DENIED
  // (private / not-a-friend). searchUsersByPrefix includes a match iff its
  // projection is readable. The mock is keyed on the doc PATH (not call order —
  // the reads run concurrently via Promise.all) so the assertion is deterministic.
  it('utesluter en profil vars projektion inte är läsbar och tar med den läsbara', async () => {
    getDocsMock.mockResolvedValueOnce({
      empty: false,
      docs: [
        { id: 'foo', data: () => ({ uid: 'uid-foo' }) },
        { id: 'foobar', data: () => ({ uid: 'uid-bar' }) },
      ],
    });
    getDocMock.mockImplementation(async (ref: { _path: string }) => {
      if (ref._path === 'publicProfiles/uid-foo') {
        return { exists: () => true, data: () => ({ displayName: 'Foo Public', username: 'foo', photoURL: null }) };
      }
      // uid-bar: projektionen är inte läsbar (privat/ej-vän) → rules nekar.
      throw new Error('Missing or insufficient permissions');
    });

    const result = await searchUsersByPrefix('foo');
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('uid-foo');
    expect(result[0].username).toBe('foo');
    expect(result[0].displayName).toBe('Foo Public');
  });

  it('utesluter en profil vars projektion saknas (aldrig backfillad / raderad)', async () => {
    getDocsMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'gone', data: () => ({ uid: 'uid-gone' }) }],
    });
    getDocMock.mockResolvedValueOnce({ exists: () => false });
    expect(await searchUsersByPrefix('gon')).toEqual([]);
  });

  it('utesluter min egen profil ur sökträffarna', async () => {
    getDocsMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'me', data: () => ({ uid: 'uid-me' }) }],
    });
    // getDoc får aldrig anropas för min egen uid — self-checken kortsluter före.
    const result = await searchUsersByPrefix('me', 'uid-me');
    expect(result).toEqual([]);
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('faller tillbaka till username om displayName saknas i projektionen', async () => {
    getDocsMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'naked', data: () => ({ uid: 'uid-naked' }) }],
    });
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ photoURL: null }), // ingen displayName
    });

    const result = await searchUsersByPrefix('nak');
    expect(result[0].displayName).toBe('naked');
  });
});
