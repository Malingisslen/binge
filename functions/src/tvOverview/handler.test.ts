import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Kör själva anropet mot en låtsas-Firestore. Källskanningen i index.test.ts visar att koden står
 * där; de här testerna visar vad TV:n får tillbaka när en läsning felar eller flaggan är av.
 */
const h = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  failing: new Set<string>(),
  groupDocs: [] as unknown[],
  watchlist: new Map<string, Record<string, unknown>[]>(),
  household: new Set<string>(),
}));

vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));
const takeRate = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
vi.mock('../tvPair', () => ({ takeRate }));

function snap(path: string) {
  const data = h.docs.get(path);
  return { exists: data !== undefined, get: (f: string) => data?.[f] };
}

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      get: async () => {
        if (h.failing.has(path)) throw new Error('unavailable');
        return snap(path);
      },
    }),
    collection: (path: string) => {
      const query = {
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        get: async () => {
          if (h.failing.has(path)) throw new Error('unavailable');
          if (path === 'groups') return { docs: h.groupDocs };
          if (path === 'sessions') return { docs: [] };
          const rows = h.watchlist.get(path) ?? [];
          return { docs: rows.map((r) => ({ data: () => r })) };
        },
      };
      return query;
    },
  }),
}));

import { tvOverview } from './index';

type Call = (req: unknown) => Promise<{ providers: number[]; sessionId: string | null; household: { members: unknown[]; view: unknown } | null }>;
const call = tvOverview as unknown as Call;
const request = (data: unknown = {}) => ({
  auth: { uid: 'tv_dev1', token: { tv: true, ownerUid: 'owner', tvDeviceId: 'dev1' } },
  data,
});

function group() {
  return {
    get: (f: string) => (f === 'memberUids' ? ['owner', 'friend'] : undefined),
    ref: { collection: () => ({ doc: (uid: string) => ({ get: async () => ({ id: uid, exists: h.household.has(uid) }) }) }) },
  };
}

const movie = (id: number, visibility: string) => ({
  tmdbId: id, mediaType: 'movie', title: `Film ${id}`, status: 'vill_se', effectiveVisibility: visibility,
});

beforeEach(() => {
  h.docs.clear();
  h.failing.clear();
  h.watchlist.clear();
  h.household.clear();
  takeRate.mockClear();
  h.groupDocs = [group()];
  h.docs.set('users/owner/tvDevices/dev1', {});
  h.docs.set('users/owner', { myProviders: [8, 337], displayName: 'Malin Test' });
  h.docs.set('users/friend', { displayName: 'Kim' });
  h.household.add('owner');
  h.household.add('friend');
});

describe('tvOverview vid körning', () => {
  it('hushållsvyn är av när flaggan saknas', async () => {
    const res = await call(request());
    expect(res.household).toBeNull();
    expect(res.providers).toEqual([8, 337]);
  });

  it('hushållsvyn kommer med när flaggan är på (så att övriga test inte är tomma)', async () => {
    h.docs.set('appConfig/tvHousehold', { enabled: true });
    const res = await call(request());
    expect(res.household).not.toBeNull();
    expect(res.household?.members).toHaveLength(2);
  });

  it('en flagga som inte går att läsa ger ingen hushållsvy men behåller tjänsterna', async () => {
    h.docs.set('appConfig/tvHousehold', { enabled: true });
    h.failing.add('appConfig/tvHousehold');
    const res = await call(request());
    expect(res.household).toBeNull();
    expect(res.providers).toEqual([8, 337]);
  });

  it('grupper som inte går att läsa ger ingen hushållsvy men behåller tjänsterna', async () => {
    h.docs.set('appConfig/tvHousehold', { enabled: true });
    h.failing.add('groups');
    const res = await call(request());
    expect(res.household).toBeNull();
    expect(res.providers).toEqual([8, 337]);
  });

  it('en bortkopplad TV avvisas', async () => {
    h.docs.delete('users/owner/tvDevices/dev1');
    await expect(call(request())).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it.each([
    ['en annan TV:s uid', { uid: 'tv_other', token: { tv: true, ownerUid: 'owner', tvDeviceId: 'dev1' } }],
    ['ingen tv-claim', { uid: 'tv_dev1', token: { ownerUid: 'owner', tvDeviceId: 'dev1' } }],
    ['ingen ägare', { uid: 'tv_dev1', token: { tv: true, tvDeviceId: 'dev1' } }],
    ['ingen enhet', { uid: 'tv_dev1', token: { tv: true, ownerUid: 'owner' } }],
  ])('avvisar %s', async (_name, auth) => {
    await expect(call({ auth, data: {} })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('begränsar anropen per enhet', async () => {
    await call(request());
    expect(takeRate).toHaveBeenCalledWith('overview_dev1', expect.anything());
  });

  it('en medlem som inte själv delar kommer inte med', async () => {
    h.docs.set('appConfig/tvHousehold', { enabled: true });
    h.household.delete('friend');
    const res = await call(request());
    expect(res.household?.members).toHaveLength(1);
  });

  it('delar bara publika titlar som båda vill se', async () => {
    h.docs.set('appConfig/tvHousehold', { enabled: true });
    const shared = [movie(1, 'public'), movie(2, 'friends'), movie(3, 'private')];
    h.watchlist.set('users/owner/watchlist', shared);
    h.watchlist.set('users/friend/watchlist', shared);
    const res = await call(request({ seated: [0, 1] }));
    const view = res.household?.view as { shared: { tmdbId: number }[] };
    expect(view.shared.map((t) => t.tmdbId)).toEqual([1]);
  });
});
