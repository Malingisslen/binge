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
  const deleteDocMock = vi.fn((..._args: unknown[]) => Promise.resolve());
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
    setMock, deleteMock, updateMock, commitMock, writeBatchMock, setDocMock, updateDocMock, deleteDocMock, addDocMock,
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
  deleteDoc: (...args: unknown[]) => mocks.deleteDocMock(...(args as [unknown])),
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
  setMock, writeBatchMock, commitMock, setDocMock, updateDocMock, deleteDocMock, addDocMock, getDocMock, getDocsMock,
  queryMock, limitMock, docMock,
} = mocks;

import {
  createGroup,
  addToGroupWatchlist,
  syncProgressToGroups,
  subscribeToMyGroups,
  getRecentSessionPicksAcrossGroups,
  refreshMyHouseholdContributions,
  joinGroupViaToken,
  acceptGroupInvite,
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
  setDocMock.mockReset();
  setDocMock.mockImplementation(async () => {});
  updateDocMock.mockReset();
  updateDocMock.mockImplementation(async () => {});
  deleteDocMock.mockReset();
  deleteDocMock.mockImplementation(async () => {});
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

// Code review (2026-07-18, high-effort pass): joinGroupViaToken/
// acceptGroupInvite's BIN-532 revert to two separate awaited writes
// reintroduced a partial-write hazard the old writeBatch made impossible —
// if the memberUids update succeeds but the member-doc write then fails, the
// uid becomes a permanent "ghost member" (full group read access via
// memberUids, but no member doc) with no way to self-heal, since
// joinGroupViaToken's own already_member guard blocks any retry. Both
// functions now roll back the memberUids add (arrayRemove) if the
// member-doc write fails.
describe('joinGroupViaToken / acceptGroupInvite — rollback on partial write failure', () => {
  it('joinGroupViaToken rullar tillbaka memberUids-tillägget om member-doc-writen failar, så retry inte blir permanent utelåst', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ memberUids: [], inviteTokenHash: 'hash-abc' }),
    });
    setDocMock
      .mockResolvedValueOnce(undefined) // steg 1: joinAttempt-skrivningen lyckas
      // steg 2: member-doc:et failar på nätverket (scenariot rollbacken finns
      // för — tab-close/tapp mellan de två awaits), inte på behörighet.
      .mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'unavailable' }));

    const result = await joinGroupViaToken({
      groupId: 'g1',
      token: 'plaintext-token',
      uid: 'user-join',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    // 2026-07-20 (xhigh code review): detta returnerade tidigare 'invalid_token'
    // — token var vid det här laget redan BEVISAT giltig (steg 1 och 2 gick
    // igenom), så att rapportera "ogiltig länk" var direkt felaktigt och sköt
    // dessutom anroparens omförsök i sank. Se den nya discrimination-testen
    // nedan: en ÄKTA permission-denied ger fortfarande 'invalid_token'.
    expect(result).toEqual({ ok: false, reason: 'transient' });

    // Rollback: en ANDRA updateDoc mot samma grupp-ref som drar tillbaka
    // memberUids-tillägget — inte bara den ursprungliga arrayUnion-writen.
    const groupRefUpdateCalls = updateDocMock.mock.calls.filter(([ref]) =>
      (ref as { _path: string })._path === 'groups/g1');
    expect(groupRefUpdateCalls).toHaveLength(2);
    const [, rollbackPayload] = groupRefUpdateCalls[1];
    expect((rollbackPayload as Record<string, unknown>).memberUids).toEqual({ _type: 'arrayRemove', vals: ['user-join'] });
  });

  it('acceptGroupInvite rullar tillbaka memberUids-tillägget om member-doc-writen failar', async () => {
    setDocMock.mockRejectedValueOnce(new Error('network error'));

    await expect(acceptGroupInvite({
      groupId: 'g2',
      uid: 'user-accept',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    })).rejects.toThrow('network error');

    const groupRefUpdateCalls = updateDocMock.mock.calls.filter(([ref]) =>
      (ref as { _path: string })._path === 'groups/g2');
    expect(groupRefUpdateCalls).toHaveLength(2);
    const [, rollbackPayload] = groupRefUpdateCalls[1];
    expect((rollbackPayload as Record<string, unknown>).memberUids).toEqual({ _type: 'arrayRemove', vals: ['user-accept'] });

    // Inbjudan raderas ALDRIG om medlemskapet inte gick igenom — annars
    // tappas möjligheten att försöka igen.
    expect(deleteDocMock).not.toHaveBeenCalled();
  });
});

// xhigh code review 2026-07-20: joinGroupViaToken svalde ALLA fel i sina
// catch-block och returnerade 'invalid_token'. Ett nätverksfel rapporterades
// därför som "länken är ogiltig eller har dragits tillbaka" — användaren bad
// ägaren rotera en token som aldrig var trasig — och anroparens retry-gren,
// som bara triggar på ett KASTAT fel, blev död kod. Testerna nedan är
// diskriminerande: de failar om de två felklasserna slås ihop igen.
describe('joinGroupViaToken — transient failures are not reported as a bad token', () => {
  const joinArgs = {
    groupId: 'g1',
    token: 'plaintext-token',
    uid: 'user-join',
    displayName: 'Malin',
    username: 'malin',
    photoURL: null,
    providers: [8],
  };
  const groupExists = () => getDocMock.mockResolvedValueOnce({
    exists: () => true,
    data: () => ({ memberUids: [], inviteTokenHash: 'hash-abc' }),
  });

  it('en ÄKTA permission-denied på joinAttempt betyder fel token', async () => {
    groupExists();
    setDocMock.mockRejectedValueOnce(
      Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }),
    );

    await expect(joinGroupViaToken(joinArgs)).resolves.toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('ett nätverksfel på joinAttempt är övergående, INTE fel token', async () => {
    groupExists();
    setDocMock.mockRejectedValueOnce(
      Object.assign(new Error('The service is currently unavailable.'), { code: 'unavailable' }),
    );

    await expect(joinGroupViaToken(joinArgs)).resolves.toEqual({ ok: false, reason: 'transient' });
  });

  it('ett fel helt utan felkod behandlas som övergående, inte som fel token', async () => {
    groupExists();
    setDocMock.mockRejectedValueOnce(new Error('boom'));

    await expect(joinGroupViaToken(joinArgs)).resolves.toEqual({ ok: false, reason: 'transient' });
  });
});

// BIN-556: the rollback tests above only exercise the FAILURE path. Two things
// stayed unguarded: (1) the same no-batch guard createGroup has — the
// members/{uid} create rule does get(groups/{id}).memberUids, and a Security
// Rule's get() never sees a sibling write queued in the same batch, so
// re-introducing writeBatch here would permission-deny in production while
// every existing test still passed; and (2) proof that the compensating
// arrayRemove does NOT fire on a clean success (a rollback that runs on the
// happy path would silently strip a valid membership).
describe('joinGroupViaToken / acceptGroupInvite — no batch + clean happy path (BIN-556)', () => {
  it('joinGroupViaToken skriver SEKVENTIELLA writes, aldrig en batch', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ memberUids: [], inviteTokenHash: 'hash-abc' }),
    });

    const result = await joinGroupViaToken({
      groupId: 'g-nb',
      token: 'plaintext-token',
      uid: 'user-nb',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    expect(result).toEqual({ ok: true });
    expect(writeBatchMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('joinGroupViaToken rullar INTE tillbaka memberUids när member-doc-writen lyckas', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ memberUids: ['someone-else'], inviteTokenHash: 'hash-abc' }),
    });

    const result = await joinGroupViaToken({
      groupId: 'g-happy',
      token: 'plaintext-token',
      uid: 'user-happy',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    expect(result).toEqual({ ok: true });

    // Exakt EN write mot grupp-doc:et — arrayUnion. Ingen kompenserande
    // arrayRemove får ha körts.
    const groupRefUpdateCalls = updateDocMock.mock.calls.filter(([ref]) =>
      (ref as { _path: string })._path === 'groups/g-happy');
    expect(groupRefUpdateCalls).toHaveLength(1);
    expect((groupRefUpdateCalls[0][1] as Record<string, unknown>).memberUids)
      .toEqual({ _type: 'arrayUnion', vals: ['user-happy'] });
    expect(updateDocMock.mock.calls.some(([, payload]) =>
      (payload as Record<string, unknown>).memberUids
        && ((payload as Record<string, unknown>).memberUids as { _type?: string })._type === 'arrayRemove',
    )).toBe(false);

    // Member-doc:et skrevs på rätt väg.
    const memberWrite = setDocMock.mock.calls.find(([ref]) =>
      (ref as { _path: string })._path === 'groups/g-happy/members/user-happy');
    expect(memberWrite).toBeDefined();
    expect(memberWrite?.[1]).toMatchObject({ uid: 'user-happy', role: 'member' });
  });

  it('acceptGroupInvite skriver SEKVENTIELLA writes, aldrig en batch', async () => {
    await acceptGroupInvite({
      groupId: 'g-nb2',
      uid: 'user-nb2',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    expect(writeBatchMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('acceptGroupInvite rullar INTE tillbaka memberUids när member-doc-writen lyckas, och raderar inbjudan', async () => {
    await acceptGroupInvite({
      groupId: 'g-happy2',
      uid: 'user-happy2',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    const groupRefUpdateCalls = updateDocMock.mock.calls.filter(([ref]) =>
      (ref as { _path: string })._path === 'groups/g-happy2');
    expect(groupRefUpdateCalls).toHaveLength(1);
    expect((groupRefUpdateCalls[0][1] as Record<string, unknown>).memberUids)
      .toEqual({ _type: 'arrayUnion', vals: ['user-happy2'] });

    const memberWrite = setDocMock.mock.calls.find(([ref]) =>
      (ref as { _path: string })._path === 'groups/g-happy2/members/user-happy2');
    expect(memberWrite).toBeDefined();

    // Inbjudan städas bort FÖRST när medlemskapet är på plats.
    expect(deleteDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ _path: 'users/user-happy2/groupInvites/g-happy2' }),
    );
  });
});
