import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted körs tillsammans med vi.mock-fabriken (hoistas till toppen).
// Krävs eftersom vanliga modul-nivå-variabler inte är tillgängliga när
// vi.mock-fabriker exekverar.
const mocks = vi.hoisted(() => {
  let autoIdCounter = 0;
  const setMock = vi.fn();
  const deleteMock = vi.fn();
  const updateMock = vi.fn();
  const commitMock = vi.fn(() => Promise.resolve());
  const writeBatchMock = vi.fn(() => ({
    set: setMock,
    delete: deleteMock,
    update: updateMock,
    commit: commitMock,
  }));
  const setDocMock = vi.fn((..._args: unknown[]) => Promise.resolve());
  const updateDocMock = vi.fn((..._args: unknown[]) => Promise.resolve());
  const addDocMock = vi.fn((coll: unknown, _data: unknown) => {
    const id = `auto-id-${++autoIdCounter}`;
    return Promise.resolve({ _path: `${(coll as { _path: string })._path}/${id}`, id });
  });
  const getDocMock = vi.fn();
  const getDocsMock = vi.fn();
  const queryMock = vi.fn((coll: unknown, ...constraints: unknown[]) => ({ _coll: coll, _constraints: constraints }));
  const whereMock = vi.fn((field: string, op: string, value: unknown) => ({ _type: 'where', field, op, value }));
  const limitMock = vi.fn((n: number) => ({ _type: 'limit', n }));
  const orderByMock = vi.fn((field: string, dir?: string) => ({ _type: 'orderBy', field, dir }));
  // doc(collectionRef) — auto-id (createGroup). doc(db, ...path) — explicit path.
  const docMock = vi.fn((first: unknown, ...rest: unknown[]) => {
    if (rest.length === 0 && first && typeof first === 'object' && '_path' in (first as Record<string, unknown>)) {
      const id = `auto-id-${++autoIdCounter}`;
      return { _path: `${(first as { _path: string })._path}/${id}`, id };
    }
    const path = rest as string[];
    return { _path: path.join('/'), id: path[path.length - 1] };
  });
  return {
    setMock, deleteMock, updateMock, commitMock, writeBatchMock, setDocMock, updateDocMock, addDocMock,
    getDocMock, getDocsMock,
    queryMock, whereMock, limitMock, orderByMock, docMock,
  };
});

// groups.ts hämtar firestore-fns via fsdb() (lazy-laddningen i ./db) — mocken
// returnerar den mockade firebase/firestore-modulen + dummy-db.
vi.mock('./db', () => ({
  fsdb: async () => ({ ...(await import('firebase/firestore')), db: {} }),
  lazySubscribe: (attach: (kit: unknown) => () => void) => {
    let unsub = () => {};
    void (async () => {
      const kit = { ...(await import('firebase/firestore')), db: {} };
      unsub = attach(kit);
    })();
    return () => unsub();
  },
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => ({ _path: path.join('/') })),
  doc: (...args: unknown[]) => mocks.docMock(...(args as [unknown, ...unknown[]])),
  setDoc: (...args: unknown[]) => mocks.setDocMock(...(args as [unknown, ...unknown[]])),
  updateDoc: (...args: unknown[]) => mocks.updateDocMock(...(args as [unknown, ...unknown[]])),
  addDoc: (...args: unknown[]) => mocks.addDocMock(...(args as [unknown, unknown])),
  getDoc: (...args: unknown[]) => mocks.getDocMock(...args),
  getDocs: (...args: unknown[]) => mocks.getDocsMock(...args),
  query: (...args: unknown[]) => mocks.queryMock(...(args as [unknown, ...unknown[]])),
  where: (...args: unknown[]) => mocks.whereMock(...(args as [string, string, unknown])),
  limit: (...args: unknown[]) => mocks.limitMock(...(args as [number])),
  orderBy: (...args: unknown[]) => mocks.orderByMock(...(args as [string, string?])),
  writeBatch: mocks.writeBatchMock,
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  deleteField: vi.fn(() => 'DELETE_FIELD'),
  arrayUnion: vi.fn((...vals: unknown[]) => ({ _type: 'arrayUnion', vals })),
  arrayRemove: vi.fn((...vals: unknown[]) => ({ _type: 'arrayRemove', vals })),
  onSnapshot: vi.fn(() => () => {}),
  Timestamp: { fromDate: vi.fn((d: Date) => d) },
}));

const {
  setMock, writeBatchMock, commitMock, setDocMock, updateDocMock, addDocMock, getDocMock, getDocsMock,
  queryMock, limitMock, docMock,
} = mocks;

import {
  createGroup,
  addToGroupWatchlist,
  syncProgressToGroups,
  subscribeToMyGroups,
  getRecentSessionPicksAcrossGroups,
  refreshMyHouseholdContributions,
  MY_GROUPS_LIMIT,
} from './groups';

function groupsQueryConstraints() {
  const call = queryMock.mock.calls.find(([coll]) => (coll as { _path?: string })?._path === 'groups');
  return call?.slice(1) as unknown[] | undefined;
}

beforeEach(() => {
  setMock.mockClear();
  writeBatchMock.mockClear();
  commitMock.mockClear();
  setDocMock.mockClear();
  updateDocMock.mockClear();
  addDocMock.mockClear();
  getDocMock.mockReset();
  getDocsMock.mockReset();
  queryMock.mockClear();
  limitMock.mockClear();
  docMock.mockClear();
});

describe('createGroup (BIN-532 REVERTED: sequential writes, not an atomic batch)', () => {
  // BIN-532's original "atomic batch" version broke createGroup entirely:
  // the members/{memberUid} create rule does get(groups/{groupId}).data.memberUids,
  // and Firestore Security Rules resolve get()/exists() against the state
  // BEFORE the whole batch/transaction — never a sibling write queued in the
  // same commit. A batched create-group + create-owner-member always
  // permission-denies in production. Reverted to two separate awaited writes
  // (addDoc the group, then setDoc the owner's member doc) — this test
  // guards against silently re-introducing the batch.
  it('skriver grupp-doc:et (addDoc) och sedan ägarens member-doc (setDoc) som TVÅ separata writes, inte en batch', async () => {
    const result = await createGroup({
      ownerUid: 'owner-1',
      ownerDisplayName: 'Malin',
      ownerUsername: 'malin',
      ownerPhotoURL: null,
      ownerProviders: [8],
      name: 'Filmkvällarna',
      defaults: { providerMode: 'intersect', aggregation: 'least_misery', mediaType: 'both' },
    });

    // Ingen batch inblandad i grupp-skapandet.
    expect(writeBatchMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();

    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [groupColl, groupPayload] = addDocMock.mock.calls[0];
    expect((groupColl as { _path: string })._path).toBe('groups');
    expect(groupPayload).toMatchObject({ ownerUid: 'owner-1', memberUids: ['owner-1'] });

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [memberRef, memberPayload] = setDocMock.mock.calls[0];
    expect((memberRef as { _path: string })._path).toBe(`groups/${result.groupId}/members/owner-1`);
    expect(memberPayload).toMatchObject({ uid: 'owner-1', role: 'owner' });

    expect(result.groupId).toBeTruthy();
    expect(result.inviteToken).toHaveLength(32); // 16 bytes hex
  });
});

describe('addToGroupWatchlist (BIN-532: bevarar memberRatings vid re-add)', () => {
  it('skriver med merge:true och utan memberRatings-fältet', async () => {
    await addToGroupWatchlist({
      groupId: 'g1',
      uid: 'me',
      tmdbId: 1438,
      mediaType: 'movie',
      title: 'Testfilm',
      posterPath: null,
      releaseYear: 2024,
    });

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [, payload, opts] = setDocMock.mock.calls[0];
    expect(opts).toEqual({ merge: true });
    expect(payload).not.toHaveProperty('memberRatings');
    expect(payload).toMatchObject({ tmdbId: 1438, addedBy: 'me' });
  });
});

describe('BIN-510: bounded array-contains queries', () => {
  it('syncProgressToGroups queryar med limit(100)', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    await syncProgressToGroups({
      uid: 'user-a',
      tmdbId: 1,
      lastWatchedSeason: 1,
      lastWatchedEpisode: 1,
    });
    const constraints = groupsQueryConstraints();
    expect(constraints).toBeDefined();
    expect(constraints).toContainEqual({ _type: 'limit', n: MY_GROUPS_LIMIT });
  });

  it('syncProgressToGroups hoppar över en ANDRA collection-scan inom TTL-fönstret för en nolgrupp-användare', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    await syncProgressToGroups({ uid: 'user-b', tmdbId: 1, lastWatchedSeason: 1, lastWatchedEpisode: 1 });
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    // Andra anropet omedelbart efter — cachen är känd-tom, ingen ny query.
    await syncProgressToGroups({ uid: 'user-b', tmdbId: 2, lastWatchedSeason: 1, lastWatchedEpisode: 2 });
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  // BIN-510/532 test review (2026-07-18): invalidateMyGroupsCache() is
  // called at all three membership-add sites, but until this test nothing
  // proved a subsequent syncProgressToGroups call actually re-queries
  // instead of reusing the stale cached (empty) list — the exact scenario
  // the original code-review FAIL was about.
  it('createGroup river cachen så nästa syncProgressToGroups-anrop tvingar en FÄRSK query, inte den gamla cachade (tomma) listan', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    await syncProgressToGroups({ uid: 'user-cache', tmdbId: 1, lastWatchedSeason: 1, lastWatchedEpisode: 1 });
    expect(getDocsMock).toHaveBeenCalledTimes(1); // cache nu varm och tom

    await createGroup({
      ownerUid: 'user-cache',
      ownerDisplayName: 'Malin',
      ownerUsername: 'malin',
      ownerPhotoURL: null,
      ownerProviders: [8],
      name: 'Nyskapad grupp',
      defaults: { providerMode: 'intersect', aggregation: 'least_misery', mediaType: 'both' },
    });

    // Utan invalidering skulle nästa anrop hoppa över queryn (samma som
    // testet ovan) och missa den nyss skapade gruppen i upp till 5 min.
    getDocsMock.mockResolvedValueOnce({ empty: false, docs: [{ id: 'the-new-group' }] });
    getDocMock.mockResolvedValueOnce({ exists: () => true });
    await syncProgressToGroups({ uid: 'user-cache', tmdbId: 2, lastWatchedSeason: 1, lastWatchedEpisode: 1 });
    expect(getDocsMock).toHaveBeenCalledTimes(2); // FÄRSK query, inte cache-hit

    const progressWrite = setDocMock.mock.calls.find(([ref]) =>
      (ref as { _path: string })._path === 'groups/the-new-group/watchlist/2/progress/user-cache');
    expect(progressWrite).toBeDefined();
  });

  it('syncProgressToGroups synkar progress till varje grupp titeln finns på (icke-tom cache)', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: false, docs: [{ id: 'g1' }, { id: 'g2' }] });
    getDocMock
      .mockResolvedValueOnce({ exists: () => true })  // g1 har titeln
      .mockResolvedValueOnce({ exists: () => false }); // g2 har inte titeln

    await syncProgressToGroups({
      uid: 'user-c',
      tmdbId: 99,
      lastWatchedSeason: 2,
      lastWatchedEpisode: 3,
    });

    // Bara g1 (som har titeln) får en progress-write.
    const progressWrite = setDocMock.mock.calls.find(([ref]) =>
      (ref as { _path: string })._path === 'groups/g1/watchlist/99/progress/user-c');
    expect(progressWrite).toBeDefined();
    const noProgressWrite = setDocMock.mock.calls.find(([ref]) =>
      (ref as { _path: string })._path === 'groups/g2/watchlist/99/progress/user-c');
    expect(noProgressWrite).toBeUndefined();
  });

  it('subscribeToMyGroups queryar med limit(100)', async () => {
    const unsub = subscribeToMyGroups('user-d', () => {});
    // lazySubscribe-mockens attach() körs bakom en dynamisk import — vänta
    // in att query() faktiskt anropats istället för att gissa antal tick.
    await vi.waitFor(() => expect(groupsQueryConstraints()).toBeDefined());
    expect(groupsQueryConstraints()).toContainEqual({ _type: 'limit', n: MY_GROUPS_LIMIT });
    unsub();
  });

  it('getRecentSessionPicksAcrossGroups queryar "mina grupper" med limit(100)', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    await getRecentSessionPicksAcrossGroups('user-e', new Date('2026-01-01'));
    const constraints = groupsQueryConstraints();
    expect(constraints).toBeDefined();
    expect(constraints).toContainEqual({ _type: 'limit', n: MY_GROUPS_LIMIT });
  });

  it('refreshMyHouseholdContributions queryar "mina grupper" med limit(100)', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    await refreshMyHouseholdContributions('user-f', {
      myProviders: [],
      providerCosts: {},
      providerTiers: {},
      providerCampaigns: {},
    });
    const constraints = groupsQueryConstraints();
    expect(constraints).toBeDefined();
    expect(constraints).toContainEqual({ _type: 'limit', n: MY_GROUPS_LIMIT });
  });
});
