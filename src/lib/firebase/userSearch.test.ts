import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocka firebase-moduler innan import. db från ./config används bara som
// argument till query-konstruktorerna och returneras vidare ihjälmockat —
// inga riktiga Firestore-anrop.
vi.mock('./config', () => ({ db: {} }));

const getDocsMock = vi.fn();
const getDocMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ _name: name })),
  doc: vi.fn((_db, name, id) => ({ _path: `${name}/${id}` })),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  query: vi.fn((...args: unknown[]) => ({ _query: args })),
  where: vi.fn((field, op, value) => ({ _where: [field, op, value] })),
  limit: vi.fn(n => ({ _limit: n })),
  orderBy: vi.fn(field => ({ _orderBy: field })),
  documentId: vi.fn(() => '__name__'),
}));

import { searchUsersByPrefix } from './userSearch';

beforeEach(() => {
  getDocsMock.mockReset();
  getDocMock.mockReset();
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
    const { query, where } = await import('firebase/firestore');
    const queryCalls = (query as ReturnType<typeof vi.fn>).mock.calls;
    expect(queryCalls.length).toBeGreaterThan(0);
    const whereCalls = (where as ReturnType<typeof vi.fn>).mock.calls;
    const lowerCalls = whereCalls.filter(c => c[1] === '>=');
    expect(lowerCalls[lowerCalls.length - 1][2]).toBe('malin');
  });

  it('returnerar tom lista när usernames-collection är tom', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    expect(await searchUsersByPrefix('foo')).toEqual([]);
  });

  it('filtrerar bort icke-publika profiler', async () => {
    getDocsMock.mockResolvedValueOnce({
      empty: false,
      docs: [
        { id: 'foo', data: () => ({ uid: 'uid-foo' }) },
        { id: 'foobar', data: () => ({ uid: 'uid-bar' }) },
      ],
    });
    getDocMock
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ displayName: 'Foo Public', isPublic: true, photoURL: null, myProviders: [] }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ displayName: 'Bar Private', isPublic: false }),
      });

    const result = await searchUsersByPrefix('foo');
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('uid-foo');
    expect(result[0].username).toBe('foo');
    expect(result[0].displayName).toBe('Foo Public');
  });

  it('hanterar permission-denied gracefully (icke-publik profil)', async () => {
    getDocsMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'denied', data: () => ({ uid: 'uid-denied' }) }],
    });
    getDocMock.mockRejectedValueOnce(new Error('Missing or insufficient permissions'));

    const result = await searchUsersByPrefix('den');
    expect(result).toEqual([]);
  });

  it('faller tillbaka till username om displayName saknas', async () => {
    getDocsMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'naked', data: () => ({ uid: 'uid-naked' }) }],
    });
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ isPublic: true }),
    });

    const result = await searchUsersByPrefix('nak');
    expect(result[0].displayName).toBe('naked');
  });
});
