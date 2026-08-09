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

import {
  getPublicProfileCard,
  getPublicProfileCards,
  syncMyPublicProfile,
  clearPublicProfileSignature,
  publicProfileSignatureKey,
} from './publicProfile';

// The on-disk form written by the pre-BIN-817 build. Spelled out literally rather
// than imported: the point of these tests is that the shipped code still recognises
// THIS exact string, so deriving it from the module under test would be circular.
const legacySig = (
  displayName: string,
  username: string | null,
  photoURL: string | null,
  bio: string,
  isPublic: boolean,
) => JSON.stringify([displayName, username, photoURL, bio, isPublic]);

let store: Record<string, string>;

beforeEach(() => {
  getDocMock.mockReset();
  setDocMock.mockReset();
  store = {};
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

  // BIN-522: pin the clamping BIN-505's reviewers verified only by manual trace.
  // users/{uid} has NO length rules on these fields at signup, but the projection
  // rule (isValidPublicProfile) caps displayName/bio/photoURL at 80/160/500 — an
  // unclamped write would fail the WHOLE atomic set and get swallowed, leaving
  // the user with no projection at all (invisible in search/friends/profile).
  it('clamps displayName (80) and bio (160) to the projection rule caps instead of failing the whole write', async () => {
    await syncMyPublicProfile('u3', {
      displayName: 'N'.repeat(200),
      username: null,
      photoURL: null,
      bio: 'B'.repeat(400),
      createdAt: null,
    });
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const payload = setDocMock.mock.calls[0][1] as Record<string, unknown>;
    expect((payload.displayName as string)).toBe('N'.repeat(80));
    expect((payload.bio as string)).toBe('B'.repeat(160));
  });

  it('omits an over-long photoURL (rule cap 500) as null; a within-cap URL passes through untouched', async () => {
    const longUrl = `https://x.example/${'p'.repeat(500)}`; // > 500 chars total
    await syncMyPublicProfile('u4', { displayName: 'A', username: null, photoURL: longUrl, bio: '', createdAt: null });
    expect((setDocMock.mock.calls[0][1] as Record<string, unknown>).photoURL).toBeNull();

    await syncMyPublicProfile('u5', { displayName: 'A', username: null, photoURL: 'https://x.example/p.jpg', bio: '', createdAt: null });
    expect((setDocMock.mock.calls[1][1] as Record<string, unknown>).photoURL).toBe('https://x.example/p.jpg');
  });
});

// BIN-817: the signature key sat on disk as readable JSON — displayName, username,
// photoURL and bio in plaintext, keyed by uid, no expiry, undisclosed in the privacy
// policy and surviving account deletion. These pin the two things that make the fix
// real: nothing readable is stored, and an existing key is still RECOGNISED so the
// changeover doesn't bill every user a redundant projection write.
describe('syncMyPublicProfile — the stored signature is not readable (BIN-817)', () => {
  it('stores no readable profile field, and nothing shaped like the old JSON array', async () => {
    await syncMyPublicProfile('u1', {
      displayName: 'Malin Gisslén',
      username: 'malin',
      photoURL: 'https://x.example/malin.jpg',
      bio: 'bor i Göteborg',
      isPublic: true,
      createdAt: null,
    });
    const stored = store[publicProfileSignatureKey('u1')];
    expect(stored).toBeDefined();
    for (const secret of ['Malin', 'Gisslén', 'malin', 'malin.jpg', 'Göteborg', 'true']) {
      expect(stored).not.toContain(secret);
    }
    // Base36 only — never starts with '[', which is what keeps the legacy-format
    // check unambiguous.
    expect(stored).toMatch(/^[0-9a-z]+$/);
  });

  it('is deterministic — identical input produces an identical signature', async () => {
    const src = { displayName: 'A', username: 'a', photoURL: null, bio: 'b', isPublic: false, createdAt: null };
    await syncMyPublicProfile('u1', src);
    const first = store[publicProfileSignatureKey('u1')];
    store = {};
    await syncMyPublicProfile('u1', { ...src });
    expect(store[publicProfileSignatureKey('u1')]).toBe(first);
  });

  it('separates two profiles that differ only in a trailing field', async () => {
    await syncMyPublicProfile('u1', { displayName: 'A', username: null, photoURL: null, bio: '', isPublic: false, createdAt: null });
    await syncMyPublicProfile('u2', { displayName: 'A', username: null, photoURL: null, bio: '', isPublic: true, createdAt: null });
    expect(store[publicProfileSignatureKey('u1')]).not.toBe(store[publicProfileSignatureKey('u2')]);
    expect(setDocMock).toHaveBeenCalledTimes(2);
  });
});

describe('syncMyPublicProfile — changeover from the old plaintext key (BIN-817)', () => {
  const src = { displayName: 'Malin', username: 'malin', photoURL: null, bio: 'hej', isPublic: true, createdAt: null };

  it('an old-format key with UNCHANGED fields costs no write, and is upgraded to the hash', async () => {
    store[publicProfileSignatureKey('u1')] = legacySig('Malin', 'malin', null, 'hej', true);
    await syncMyPublicProfile('u1', src);
    expect(setDocMock).toHaveBeenCalledTimes(0);
    const upgraded = store[publicProfileSignatureKey('u1')];
    expect(upgraded).not.toContain('Malin');
    expect(upgraded.startsWith('[')).toBe(false);
  });

  it('an old-format key with a CHANGED field still writes once, and stores the hash', async () => {
    store[publicProfileSignatureKey('u1')] = legacySig('Malin', 'malin', null, 'gammal bio', true);
    await syncMyPublicProfile('u1', src);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(store[publicProfileSignatureKey('u1')]).not.toContain('hej');
  });

  it('after the upgrade the next identical load is still a no-op', async () => {
    store[publicProfileSignatureKey('u1')] = legacySig('Malin', 'malin', null, 'hej', true);
    await syncMyPublicProfile('u1', src);
    await syncMyPublicProfile('u1', { ...src });
    expect(setDocMock).toHaveBeenCalledTimes(0);
  });
});

describe('clearPublicProfileSignature (BIN-817)', () => {
  it('removes only the named uid\'s key', () => {
    store[publicProfileSignatureKey('u1')] = 'abc';
    store[publicProfileSignatureKey('u2')] = 'def';
    clearPublicProfileSignature('u1');
    expect(store[publicProfileSignatureKey('u1')]).toBeUndefined();
    expect(store[publicProfileSignatureKey('u2')]).toBe('def');
  });

  it('never throws when localStorage is unavailable (Safari private mode)', () => {
    vi.stubGlobal('window', {
      localStorage: { removeItem: () => { throw new Error('QuotaExceededError'); } },
    });
    expect(() => clearPublicProfileSignature('u1')).not.toThrow();
  });
});
