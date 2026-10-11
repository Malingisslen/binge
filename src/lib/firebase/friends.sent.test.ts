import { describe, it, expect, vi, beforeEach } from 'vitest';

const getDocsMock = vi.fn();
const getDocMock = vi.fn();
const whereMock = vi.fn((field: unknown, op: unknown, value: unknown) => ({ _where: [field, op, value] }));
const queryMock = vi.fn((...parts: unknown[]) => ({ _parts: parts }));

vi.mock('./db', () => ({
  fsdb: async () => ({
    db: {},
    collection: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
    doc: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
    getDoc: getDocMock,
    getDocs: getDocsMock,
    query: queryMock,
    where: whereMock,
    limit: (n: unknown) => ({ _limit: n }),
    orderBy: (field: unknown, dir: unknown) => ({ _orderBy: [field, dir] }),
  }),
}));

import { listSentFriendRequests } from './friends';

const sentDoc = (id: string) => ({ id, data: () => ({ uid: id, sentAt: { toDate: () => new Date('2026-10-01') } }) });

beforeEach(() => {
  getDocsMock.mockReset();
  getDocMock.mockReset();
  queryMock.mockClear();
  whereMock.mockClear();
});

describe('listSentFriendRequests', () => {
  it('returns an empty list without further reads when nothing is sent', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    expect(await listSentFriendRequests('me')).toEqual([]);
    expect(getDocMock).not.toHaveBeenCalled();
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('orders newest first with a limit of 50', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    await listSentFriendRequests('me');
    const parts = queryMock.mock.calls[0];
    expect(parts).toContainEqual({ _path: 'users/me/friendRequestsSent' });
    expect(parts).toContainEqual({ _orderBy: ['sentAt', 'desc'] });
    expect(parts).toContainEqual({ _limit: 50 });
  });

  it('uses the profile card when readable and does not query usernames', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: false, docs: [sentDoc('u1')] });
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ displayName: 'Greta', username: 'greta' }),
    });
    const [r] = await listSentFriendRequests('me');
    expect(r).toMatchObject({ toUid: 'u1', displayName: 'Greta', username: 'greta' });
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('resolves the handle from usernames for a card that cannot be read', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: false, docs: [sentDoc('u1')] });
    getDocMock.mockRejectedValueOnce(new Error('permission-denied'));
    getDocsMock.mockResolvedValueOnce({ docs: [{ id: 'greta' }] });
    const [r] = await listSentFriendRequests('me');
    expect(r).toMatchObject({ toUid: 'u1', displayName: null, username: 'greta' });
    expect(whereMock).toHaveBeenCalledWith('uid', '==', 'u1');
  });

  it('leaves both null when no handle exists, and when the handle query fails', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: false, docs: [sentDoc('u1'), sentDoc('u2')] });
    getDocMock.mockRejectedValue(new Error('permission-denied'));
    getDocsMock.mockResolvedValueOnce({ docs: [] });
    getDocsMock.mockRejectedValueOnce(new Error('unavailable'));
    const rows = await listSentFriendRequests('me');
    expect(rows.map(r => [r.displayName, r.username])).toEqual([[null, null], [null, null]]);
  });
});
