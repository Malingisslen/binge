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

// Per-test dokumentfixturer, nyckel = ref._path. Töms av beforeEach.
const docFixtures = new Map<string, unknown>();
function seedDoc(path: string, snap: unknown) { docFixtures.set(path, snap); }

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
  // BIN-1063 steg 1: writeMemberDoc läser medlemsdokumentet innan det skriver,
  // så getDoc träffas nu på TVÅ olika sökvägar per anrop. Svara på sökväg i
  // stället för på anropsordning — annars avgör ordningen vilken läsning en
  // stub besvarar, och testet blir grönt av fel skäl.
  docFixtures.clear();
  getDocMock.mockImplementation(async (ref: unknown) => {
    const path = (ref as { _path: string })._path;
    if (docFixtures.has(path)) return docFixtures.get(path);
    // Ett medlemsdokument finns inte som standard: förstagångs-accept är
    // normalfallet, och ett test som menar något annat säger det uttryckligen.
    if (/\/members\//.test(path)) return { exists: () => false, data: () => undefined };
    return { exists: () => true, data: () => ({ memberUids: [] }) };
  });
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

    // BIN-556's counterpart guard, for BIN-555's rollback: a compensating delete
    // that also fired on the happy path would erase every group as it was
    // created. The rollback is asserted to run in the failure tests below; this
    // asserts it does NOT run here.
    expect(deleteDocMock).not.toHaveBeenCalled();
  });

  // BIN-555 (stakeholder panel 2026-08-06: Security Architect + DBA + Codebase
  // Archaeologist, all three independently). If the owner's member doc fails to
  // write, the group doc created a line earlier is left ownerless forever —
  // memberUids already grants the owner full access, so it shows up in their
  // "my groups" list while its member list renders empty, and no sweep exists
  // to reap it. The compensating action here is DELETING the group doc, not
  // arrayRemove-ing the owner out of memberUids (the sibling flows' pattern):
  // an arrayRemove would leave the very orphan this ticket exists to remove,
  // and strip it out of the owner's own array-contains query at the same time,
  // making it unfindable.
  describe('BIN-555: ägarlöst grupp-doc rullas tillbaka om member-writen failar', () => {
    it('raderar grupp-doc:et, kastar felet vidare, och rör inte memberUids', async () => {
      const boom = new Error('network lost');
      setDocMock.mockRejectedValueOnce(boom);

      await expect(createGroup({
        ownerUid: 'owner-1',
        ownerDisplayName: 'Malin',
        ownerUsername: 'malin',
        ownerPhotoURL: null,
        ownerProviders: [8],
        name: 'Filmkvällarna',
        defaults: { providerMode: 'intersect', aggregation: 'least_misery', mediaType: 'both' },
      })).rejects.toThrow('network lost');

      // Grupp-doc:et som just skapades är borta igen.
      expect(deleteDocMock).toHaveBeenCalledTimes(1);
      const groupId = (await addDocMock.mock.results[0].value as { id: string }).id;
      expect((deleteDocMock.mock.calls[0][0] as { _path: string })._path).toBe(`groups/${groupId}`);

      // INTE sibling-flödenas arrayRemove — det hade lämnat kvar doc:et.
      expect(updateDocMock).not.toHaveBeenCalled();
      // Och fortfarande ingen batch: kompensationen får inte smyga in atomicitet.
      expect(writeBatchMock).not.toHaveBeenCalled();
    });

    it('kastar ORIGINALFELET även när rollback-raderingen själv failar, så anroparen aldrig får ett id till en grupp som inte finns', async () => {
      const boom = new Error('network lost');
      setDocMock.mockRejectedValueOnce(boom);
      deleteDocMock.mockRejectedValueOnce(new Error('rollback failed too'));

      await expect(createGroup({
        ownerUid: 'owner-1',
        ownerDisplayName: 'Malin',
        ownerUsername: 'malin',
        ownerPhotoURL: null,
        ownerProviders: [8],
        name: 'Filmkvällarna',
        defaults: { providerMode: 'intersect', aggregation: 'least_misery', mediaType: 'both' },
      })).rejects.toThrow('network lost');

      expect(deleteDocMock).toHaveBeenCalledTimes(1);
    });
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

  // BIN-560 Phase 5: the collision this cutover prevents — a movie and a TV show
  // sharing a TMDB number must land in DISTINCT namespaced group-watchlist docs.
  it('a movie and a same-numbered tv show write to distinct namespaced docs (movie_5 / tv_5)', async () => {
    const base = { groupId: 'g1', uid: 'me', title: 'X', posterPath: null, releaseYear: 2024 };
    await addToGroupWatchlist({ ...base, tmdbId: 5, mediaType: 'movie' });
    await addToGroupWatchlist({ ...base, tmdbId: 5, mediaType: 'tv' });
    const paths = setDocMock.mock.calls.map(([ref]) => (ref as { _path: string })._path);
    expect(paths).toContain('groups/g1/watchlist/movie_5');
    expect(paths).toContain('groups/g1/watchlist/tv_5');
  });
});

describe('BIN-510: bounded array-contains queries', () => {
  it('syncProgressToGroups queryar med limit(100)', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    await syncProgressToGroups({
      uid: 'user-a',
      mediaType: 'tv',
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
    await syncProgressToGroups({ uid: 'user-b', mediaType: 'tv', tmdbId: 1, lastWatchedSeason: 1, lastWatchedEpisode: 1 });
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    // Andra anropet omedelbart efter — cachen är känd-tom, ingen ny query.
    await syncProgressToGroups({ uid: 'user-b', mediaType: 'tv', tmdbId: 2, lastWatchedSeason: 1, lastWatchedEpisode: 2 });
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  // BIN-510/532 test review (2026-07-18): invalidateMyGroupsCache() is
  // called at all three membership-add sites, but until this test nothing
  // proved a subsequent syncProgressToGroups call actually re-queries
  // instead of reusing the stale cached (empty) list — the exact scenario
  // the original code-review FAIL was about.
  it('createGroup river cachen så nästa syncProgressToGroups-anrop tvingar en FÄRSK query, inte den gamla cachade (tomma) listan', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    await syncProgressToGroups({ uid: 'user-cache', mediaType: 'tv', tmdbId: 1, lastWatchedSeason: 1, lastWatchedEpisode: 1 });
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
    await syncProgressToGroups({ uid: 'user-cache', mediaType: 'tv', tmdbId: 2, lastWatchedSeason: 1, lastWatchedEpisode: 1 });
    expect(getDocsMock).toHaveBeenCalledTimes(2); // FÄRSK query, inte cache-hit

    const progressWrite = setDocMock.mock.calls.find(([ref]) =>
      (ref as { _path: string })._path === 'groups/the-new-group/watchlist/tv_2/progress/user-cache');
    expect(progressWrite).toBeDefined();
  });

  it('syncProgressToGroups synkar progress till varje grupp titeln finns på (icke-tom cache)', async () => {
    getDocsMock.mockResolvedValueOnce({ empty: false, docs: [{ id: 'g1' }, { id: 'g2' }] });
    getDocMock
      .mockResolvedValueOnce({ exists: () => true })  // g1 har titeln
      .mockResolvedValueOnce({ exists: () => false }); // g2 har inte titeln

    await syncProgressToGroups({
      uid: 'user-c',
      mediaType: 'tv',
      tmdbId: 99,
      lastWatchedSeason: 2,
      lastWatchedEpisode: 3,
    });

    // Bara g1 (som har titeln) får en progress-write.
    const progressWrite = setDocMock.mock.calls.find(([ref]) =>
      (ref as { _path: string })._path === 'groups/g1/watchlist/tv_99/progress/user-c');
    expect(progressWrite).toBeDefined();
    const noProgressWrite = setDocMock.mock.calls.find(([ref]) =>
      (ref as { _path: string })._path === 'groups/g2/watchlist/tv_99/progress/user-c');
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

    // acceptGroupInvite läser gruppdoc:et (already_member-spärren) och därefter
    // medlemsdokumentet. Båda besvaras av sökvägsdefaulten ovan; ingen stub behövs.
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
    // acceptGroupInvite läser gruppdoc:et (already_member-spärren) och därefter
    // medlemsdokumentet. Båda besvaras av sökvägsdefaulten ovan; ingen stub behövs.
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
    // acceptGroupInvite läser gruppdoc:et (already_member-spärren) och därefter
    // medlemsdokumentet. Båda besvaras av sökvägsdefaulten ovan; ingen stub behövs.
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


// BIN-1063 steg 1. acceptGroupInvite saknade den already_member-spärr
// joinGroupViaToken alltid haft. Ett andra accept är nåbart när inbjudan sist i
// flödet inte hann raderas.
//
// Båda riktningarna drivs: spärren fäller omförsöket OCH släpper igenom en äkta
// förstagångs-accept. Utan den positiva tvillingen passerar en mutant som
// kortsluter varje accept.
describe('acceptGroupInvite — already_member-spärren (BIN-1063 steg 1)', () => {
  it('ett andra accept skriver INTE om member-doc:et och rör INTE memberUids', async () => {
    seedDoc('groups/g-again', {
      exists: () => true,
      data: () => ({ memberUids: ['someone-else', 'user-again'] }),
    });
    // Medlemsdokumentet FINNS — det är detta som skiljer ett avslutat medlemskap
    // från en spöke-medlem, och bara det förra får kortslutas.
    seedDoc('groups/g-again/members/user-again', { exists: () => true, data: () => ({ uid: 'user-again' }) });

    await acceptGroupInvite({
      groupId: 'g-again',
      uid: 'user-again',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    // Ingen member-doc-write: den hade blivit en UPDATE och nekats av reglerna.
    expect(setDocMock.mock.calls.find(([ref]) =>
      (ref as { _path: string })._path === 'groups/g-again/members/user-again')).toBeUndefined();

    // Och framför allt: ingen arrayUnion, alltså heller ingen rollback som
    // arrayRemove:ar en medlem som redan är med.
    expect(updateDocMock.mock.calls.filter(([ref]) =>
      (ref as { _path: string })._path === 'groups/g-again')).toHaveLength(0);

    // Den inaktuella inbjudan städas ändå bort — det är hela skälet att ett
    // andra accept ens kunde ske.
    expect(deleteDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ _path: 'users/user-again/groupInvites/g-again' }),
    );
  });

  it('ett förstagångs-accept går igenom spärren och skriver member-doc:et', async () => {
    seedDoc('groups/g-first', {
      exists: () => true,
      data: () => ({ memberUids: ['someone-else'] }),
    });

    await acceptGroupInvite({
      groupId: 'g-first',
      uid: 'user-first',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    expect(setDocMock.mock.calls.find(([ref]) =>
      (ref as { _path: string })._path === 'groups/g-first/members/user-first')).toBeDefined();
    expect(updateDocMock.mock.calls.filter(([ref]) =>
      (ref as { _path: string })._path === 'groups/g-first')).toHaveLength(1);
  });
});

// BIN-1063 steg 1, andra halvan. Att pinna joinedAt vid create gör en OVILLKORLIG
// setDoc utan merge farlig: träffar den ett dokument som redan finns är den en
// rules-update med ett nytt joinedAt, nekas, och anroparens catch rullar tillbaka
// medlemskapet.
//
// De fyra tillstånden en accept kan möta:
//   uid i memberUids + dokument finns   → avslutat medlemskap, kortslut
//   uid i memberUids + dokument saknas  → spöke-medlem
//   uid saknas + dokument finns         → omvänt föräldralöst, ska läkas UTAN joinedAt
//   uid saknas + dokument saknas        → vanlig förstagångs-accept
describe('accept/join — medlemsdokumentet skrivs som create eller merge efter tillstånd (BIN-1063 steg 1)', () => {
  function writeTo(path: string) {
    return setDocMock.mock.calls.find(([ref]) => (ref as { _path: string })._path === path);
  }

  // VAD DE HÄR TESTERNA INTE VISAR, sagt rakt ut: firebase/firestore är mockat i
  // den här filen, så varje write resolvar och inga säkerhetsregler utvärderas.
  // De pinnar klientens GRENVAL, aldrig att en skrivning skulle gå igenom skarpt.
  // Vad reglerna faktiskt gör med de här tillstånden pinnas av emulatorsviten.
  it('spöke-medlem (uid i memberUids, dokument saknas) kortsluts INTE', async () => {
    seedDoc('groups/g-ghost', {
      exists: () => true,
      data: () => ({ memberUids: ['someone-else', 'user-ghost'] }),
    });
    seedDoc('groups/g-ghost/members/user-ghost', { exists: () => false, data: () => undefined });

    await acceptGroupInvite({
      groupId: 'g-ghost',
      uid: 'user-ghost',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    }).catch(() => {});

    // Grenvalet, och bara det: spärren kortslöt INTE, så flödet gick vidare till
    // gruppuppdateringen. Vad reglerna gör med den vägen är emulatorsvitens att pinna.
    expect(updateDocMock.mock.calls.filter(([ref]) =>
      (ref as { _path: string })._path === 'groups/g-ghost')).toHaveLength(1);
  });

  it('omvänt föräldralöst (dokument finns, uid saknas i memberUids) skrivs som merge UTAN joinedAt', async () => {
    seedDoc('groups/g-orphan', {
      exists: () => true,
      data: () => ({ memberUids: ['someone-else'] }),
    });
    seedDoc('groups/g-orphan/members/user-orphan', { exists: () => true, data: () => ({ uid: 'user-orphan' }) });

    await acceptGroupInvite({
      groupId: 'g-orphan',
      uid: 'user-orphan',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    const write = writeTo('groups/g-orphan/members/user-orphan');
    expect(write).toBeDefined();
    // Uppdatering: joinedAt utelämnas HELT, annars nekar regeln och rollbacken
    // kastar ut en medlem som just lades tillbaka.
    expect(write?.[1]).not.toHaveProperty('joinedAt');
    expect(write?.[2]).toEqual({ merge: true });
  });

  it('joinGroupViaToken skriver också merge UTAN joinedAt mot ett dokument som redan finns', async () => {
    seedDoc('groups/g-jorphan', {
      exists: () => true,
      data: () => ({ memberUids: ['someone-else'], inviteTokenHash: 'hash-abc' }),
    });
    seedDoc('groups/g-jorphan/members/user-jorphan', { exists: () => true, data: () => ({ uid: 'user-jorphan' }) });

    const result = await joinGroupViaToken({
      groupId: 'g-jorphan',
      token: 'plaintext-token',
      uid: 'user-jorphan',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    expect(result).toEqual({ ok: true });
    const write = writeTo('groups/g-jorphan/members/user-jorphan');
    expect(write).toBeDefined();
    expect(write?.[1]).not.toHaveProperty('joinedAt');
    expect(write?.[2]).toEqual({ merge: true });
  });

  // Spärren tittar på memberUids ensamt — den läser inte medlemsdokumentet. Ett
  // spöke får därför också already_member. Varför ett spöke inte går att reparera
  // härifrån alls: BIN-1097, och emulatorsviten pinnar mekanismen.
  it('joinGroupViaToken svarar already_member när uid redan står i memberUids', async () => {
    seedDoc('groups/g-jmember', {
      exists: () => true,
      data: () => ({ memberUids: ['user-jmember'], inviteTokenHash: 'hash-abc' }),
    });

    const result = await joinGroupViaToken({
      groupId: 'g-jmember',
      token: 'plaintext-token',
      uid: 'user-jmember',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    expect(result).toEqual({ ok: false, reason: 'already_member' });
    expect(writeTo('groups/g-jmember/members/user-jmember')).toBeUndefined();
  });

  it('vanlig förstagångs-accept skriver ett create med joinedAt och ingen merge', async () => {
    seedDoc('groups/g-plain', {
      exists: () => true,
      data: () => ({ memberUids: ['someone-else'] }),
    });

    await acceptGroupInvite({
      groupId: 'g-plain',
      uid: 'user-plain',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });

    const write = writeTo('groups/g-plain/members/user-plain');
    expect(write).toBeDefined();
    expect(write?.[1]).toHaveProperty('joinedAt');
    expect(write?.[2]).toBeUndefined();
  });
});

// BIN-1100. createGroup skriver medlemsdokumentet med en bar create — gruppen
// skapades med addDoc raden innan, så dokumentet kan inte finnas, och läsningen
// writeMemberDoc gör vore ett svar vi redan känner. Båda vägarna bygger ändå sin
// payload ur samma memberFields(), och DET är vad som hindrar dem från att glida
// isär. Utan ett test på det är delningen bara en konvention.
//
// Testet jämför NYCKLAR, inte värden: role skiljer sig med flit (owner mot
// member), och joinedAt sätts av båda men på olika villkor.
describe('medlemsdokumentets fältuppsättning är delad mellan createGroup och join-flödena (BIN-1100)', () => {
  function keysWrittenTo(path: string) {
    const call = setDocMock.mock.calls.find(([ref]) => (ref as { _path: string })._path === path);
    expect(call).toBeDefined();
    return Object.keys(call![1] as Record<string, unknown>).sort();
  }

  it('createGroup och ett förstagångs-accept skriver samma fältnycklar', async () => {
    const created = await createGroup({
      name: 'Filmklubben',
      ownerUid: 'owner-fields',
      ownerDisplayName: 'Malin',
      ownerUsername: 'malin',
      ownerPhotoURL: null,
      ownerProviders: [8],
      defaults: { providerMode: 'intersect', aggregation: 'least_misery', mediaType: 'both' },
    });
    const ownerKeys = keysWrittenTo('groups/' + created.groupId + '/members/owner-fields');

    setDocMock.mockClear();
    seedDoc('groups/g-fields', {
      exists: () => true,
      data: () => ({ memberUids: ['someone-else'] }),
    });
    await acceptGroupInvite({
      groupId: 'g-fields',
      uid: 'user-fields',
      displayName: 'Malin',
      username: 'malin',
      photoURL: null,
      providers: [8],
    });
    const joinerKeys = keysWrittenTo('groups/g-fields/members/user-fields');

    expect(ownerKeys).toEqual(joinerKeys);
    // BIN-1101
    expect(ownerKeys).toEqual([
      'displayName',
      'joinedAt',
      'notifications',
      'photoURL',
      'providers',
      'role',
      'uid',
      'username',
    ]);
  });
});
