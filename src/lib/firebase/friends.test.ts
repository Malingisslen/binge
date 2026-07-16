import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted körs tillsammans med vi.mock-fabriken (hoistas till toppen).
// Krävs eftersom vanliga modul-nivå-variabler inte är tillgängliga när
// vi.mock-fabriker exekverar.
const mocks = vi.hoisted(() => {
  const setMock = vi.fn();
  const deleteMock = vi.fn();
  const commitMock = vi.fn(() => Promise.resolve());
  const writeBatchMock = vi.fn(() => ({
    set: setMock,
    delete: deleteMock,
    commit: commitMock,
  }));
  const getDocMock = vi.fn();
  const getDocsMock = vi.fn();
  return { setMock, deleteMock, commitMock, writeBatchMock, getDocMock, getDocsMock };
});

// friends.ts hämtar firestore-fns via fsdb() (lazy-laddningen i ./db) —
// mocken returnerar den mockade firebase/firestore-modulen + dummy-db.
vi.mock('./db', () => ({
  fsdb: async () => ({ ...(await import('firebase/firestore')), db: {} }),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...path) => ({ _path: path.join('/') })),
  doc: vi.fn((_db, ...path) => ({ _path: path.join('/') })),
  getDoc: (...args: unknown[]) => mocks.getDocMock(...args),
  getDocs: (...args: unknown[]) => mocks.getDocsMock(...args),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  writeBatch: mocks.writeBatchMock,
}));

const { setMock, deleteMock, commitMock, writeBatchMock, getDocMock, getDocsMock } = mocks;

import {
  sendFriendRequest,
  cancelFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  getFriendStatus,
  listFriends,
} from './friends';

beforeEach(() => {
  setMock.mockClear();
  deleteMock.mockClear();
  commitMock.mockClear();
  writeBatchMock.mockClear();
  getDocMock.mockReset();
  getDocsMock.mockReset();
});

describe('sendFriendRequest', () => {
  it('skapar incoming + outgoing-spegelräkning i en batch', async () => {
    await sendFriendRequest('me', 'Malin', null, 'malin', 'jonatan');
    expect(writeBatchMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(2);
    expect(commitMock).toHaveBeenCalledTimes(1);
    // Verifiera path-konstruktion: incoming på mottagaren, outgoing på mig.
    expect(setMock.mock.calls[0][0]._path).toBe('users/jonatan/friendRequests/me');
    expect(setMock.mock.calls[0][1]).toMatchObject({
      fromUid: 'me',
      fromDisplayName: 'Malin',
      fromUsername: 'malin',
    });
    expect(setMock.mock.calls[1][0]._path).toBe('users/me/friendRequestsSent/jonatan');
  });

  it('vägrar self-request', async () => {
    await expect(sendFriendRequest('me', 'M', null, null, 'me')).rejects.toThrow();
  });
});

describe('cancelFriendRequest', () => {
  it('raderar både incoming på mottagaren och outgoing-spegel', async () => {
    await cancelFriendRequest('me', 'jonatan');
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock.mock.calls[0][0]._path).toBe('users/jonatan/friendRequests/me');
    expect(deleteMock.mock.calls[1][0]._path).toBe('users/me/friendRequestsSent/jonatan');
    expect(commitMock).toHaveBeenCalledTimes(1);
  });
});

describe('acceptFriendRequest', () => {
  it('skapar mutuell friendship + rensar request-spår atomiskt', async () => {
    await acceptFriendRequest('me', 'jonatan');
    expect(writeBatchMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(2);   // friends båda håll
    expect(deleteMock).toHaveBeenCalledTimes(2); // request båda håll
    expect(commitMock).toHaveBeenCalledTimes(1);
    // Båda håll av friends-relationen.
    expect(setMock.mock.calls[0][0]._path).toBe('users/me/friends/jonatan');
    expect(setMock.mock.calls[1][0]._path).toBe('users/jonatan/friends/me');
    // Request-rensning.
    expect(deleteMock.mock.calls[0][0]._path).toBe('users/me/friendRequests/jonatan');
    expect(deleteMock.mock.calls[1][0]._path).toBe('users/jonatan/friendRequestsSent/me');
  });
});

describe('declineFriendRequest', () => {
  it('raderar bara request-spår — ingen friendship skapas', async () => {
    await declineFriendRequest('me', 'jonatan');
    expect(setMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledTimes(2);
    // Pinna exakt VILKA paths som raderas (BIN-339): incoming-request på MIN nod
    // + outgoing-spegel på sändarens nod. Utan detta skulle en path-swap (radera
    // fel användares nod → kvarvarande spök-request synlig för sändaren) passera
    // odetekterad — precis som syskon-testerna cancel/accept redan pinnar.
    expect(deleteMock.mock.calls[0][0]._path).toBe('users/me/friendRequests/jonatan');
    expect(deleteMock.mock.calls[1][0]._path).toBe('users/jonatan/friendRequestsSent/me');
    expect(commitMock).toHaveBeenCalledTimes(1);
  });
});

describe('removeFriend', () => {
  it('raderar friendship på båda håll', async () => {
    await removeFriend('me', 'jonatan');
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock.mock.calls[0][0]._path).toBe('users/me/friends/jonatan');
    expect(deleteMock.mock.calls[1][0]._path).toBe('users/jonatan/friends/me');
  });
});

describe('getFriendStatus', () => {
  function mockGetDocResults(opts: { friends: boolean; sent: boolean; received: boolean }) {
    getDocMock
      .mockResolvedValueOnce({ exists: () => opts.friends })
      .mockResolvedValueOnce({ exists: () => opts.sent })
      .mockResolvedValueOnce({ exists: () => opts.received });
  }

  it("returnerar 'friends' när friendship-doc:et finns", async () => {
    mockGetDocResults({ friends: true, sent: false, received: false });
    expect(await getFriendStatus('me', 'jonatan')).toBe('friends');
  });

  it("returnerar 'sent' när bara outgoing-tracking finns", async () => {
    mockGetDocResults({ friends: false, sent: true, received: false });
    expect(await getFriendStatus('me', 'jonatan')).toBe('sent');
  });

  it("returnerar 'received' när bara inkommen request finns", async () => {
    mockGetDocResults({ friends: false, sent: false, received: true });
    expect(await getFriendStatus('me', 'jonatan')).toBe('received');
  });

  it("returnerar 'none' när inget hittas", async () => {
    mockGetDocResults({ friends: false, sent: false, received: false });
    expect(await getFriendStatus('me', 'jonatan')).toBe('none');
  });

  it("returnerar 'none' för egna profilen utan att fråga Firestore", async () => {
    expect(await getFriendStatus('me', 'me')).toBe('none');
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it("'friends' vinner över 'sent' om båda finns (race-tolerans)", async () => {
    mockGetDocResults({ friends: true, sent: true, received: false });
    expect(await getFriendStatus('me', 'jonatan')).toBe('friends');
  });
});

describe('listFriends', () => {
  it('returnerar tom array när inga vänner finns', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    expect(await listFriends('me')).toEqual([]);
  });

  it('joinar friend-doc med profile-doc för displayName/photo', async () => {
    const since = { toDate: () => new Date('2026-01-01') };
    getDocsMock.mockResolvedValueOnce({
      empty: false,
      docs: [
        { id: 'jonatan', data: () => ({ since }) },
      ],
    });
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ displayName: 'Jonatan', photoURL: 'http://avatar', username: 'jonatan' }),
    });
    const result = await listFriends('me');
    expect(result).toEqual([{
      uid: 'jonatan',
      displayName: 'Jonatan',
      photoURL: 'http://avatar',
      username: 'jonatan',
      since: new Date('2026-01-01'),
    }]);
  });

  // BIN-505: a friend whose public projection isn't readable (not yet backfilled)
  // is KEPT with a fallback name — NOT dropped. Account deletion cascades BOTH
  // sides of the friends mirror (accountDeletion §2b), so a surviving friend-doc
  // means a real, existing friend; a missing projection just means un-backfilled.
  it('behåller en vän utan läsbar projektion med fallback-namn', async () => {
    getDocsMock.mockResolvedValueOnce({
      empty: false,
      docs: [
        { id: 'nobackfill', data: () => ({ since: { toDate: () => new Date('2026-01-01') } }) },
      ],
    });
    getDocMock.mockResolvedValueOnce({ exists: () => false });
    expect(await listFriends('me')).toEqual([{
      uid: 'nobackfill',
      displayName: 'Användare',
      photoURL: null,
      username: null,
      since: new Date('2026-01-01'),
    }]);
  });
});
