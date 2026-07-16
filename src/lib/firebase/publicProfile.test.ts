import { describe, it, expect, vi, beforeEach } from 'vitest';

// BIN-505: unit-test the public-projection helper without Firebase. fsdb() is
// mocked to a path-encoding kit so reads/writes can be pinned by doc path.
const getDocMock = vi.fn(async (_ref?: unknown): Promise<unknown> => ({ exists: () => false }));
const setDocMock = vi.fn(async (_ref?: unknown, _data?: unknown, _opts?: unknown): Promise<void> => {});

vi.mock('./db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, name: string, id: string) => ({ _path: `${name}/${id}` }),
    getDoc: (ref: unknown) => getDocMock(ref),
    setDoc: (ref: unknown, data: unknown, opts?: unknown) => setDocMock(ref, data, opts),
    serverTimestamp: () => 'ts',
  }),
}));
vi.mock('./utils', () => ({ toDate: (v: unknown) => (v ? new Date(0) : null) }));

import { getPublicProfileCard, getPublicProfileCards, syncMyPublicProfile } from './publicProfile';

beforeEach(() => {
  getDocMock.mockReset();
  setDocMock.mockReset();
  const store: Record<string, string> = {};
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
  });
});

describe('getPublicProfileCard', () => {
  it('maps a readable projection doc to a card (display fields only)', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ displayName: 'Malin', username: 'malin', photoURL: null, bio: 'hej', createdAt: 1 }),
    });
    const card = await getPublicProfileCard('u1');
    expect(card).toMatchObject({ uid: 'u1', displayName: 'Malin', username: 'malin', bio: 'hej' });
  });

  it('returns null when the projection doc is missing', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false });
    expect(await getPublicProfileCard('u1')).toBeNull();
  });

  it('returns null (never throws) when the read is DENIED (private / not-a-friend)', async () => {
    getDocMock.mockRejectedValueOnce(new Error('Missing or insufficient permissions'));
    await expect(getPublicProfileCard('u1')).resolves.toBeNull();
  });
});

describe('getPublicProfileCards', () => {
  it('returns a map keyed by uid, omitting the unreadable ones (no crash)', async () => {
    getDocMock.mockImplementation(async (ref: unknown) => {
      if ((ref as { _path: string })._path === 'publicProfiles/a') {
        return { exists: () => true, data: () => ({ displayName: 'A' }) };
      }
      throw new Error('denied'); // b: private/not-a-friend
    });
    const map = await getPublicProfileCards(['a', 'b']);
    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(false);
    expect(map.get('a')?.displayName).toBe('A');
  });
});

describe('syncMyPublicProfile', () => {
  it('writes only display fields, then skips an identical second write (signature-guarded)', async () => {
    const src = { displayName: 'Malin', username: 'malin', photoURL: null, bio: 'hej', isPublic: true, createdAt: new Date(0) };
    await syncMyPublicProfile('u1', src);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const payload = setDocMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toMatchObject({ displayName: 'Malin', username: 'malin', bio: 'hej', isPublic: true });
    // No sensitive fields ever leak into the projection write.
    expect('email' in payload).toBe(false);
    expect('providerCosts' in payload).toBe(false);
    expect('hemkommun' in payload).toBe(false);

    await syncMyPublicProfile('u1', { ...src });
    expect(setDocMock).toHaveBeenCalledTimes(1); // skipped — unchanged signature
  });

  it('writes again when a display field actually changes', async () => {
    await syncMyPublicProfile('u2', { displayName: 'A', username: null, photoURL: null, bio: '', createdAt: null });
    await syncMyPublicProfile('u2', { displayName: 'B', username: null, photoURL: null, bio: '', createdAt: null });
    expect(setDocMock).toHaveBeenCalledTimes(2);
  });
});
