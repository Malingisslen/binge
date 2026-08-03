import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mocks -----------------------------------------------------------------
// Samma harness-mönster som WatchlistContext.test.tsx: mocka Firebase-kanterna,
// behåll contexten + de rena helpers (canonicalProviderId m.fl.) äkta.

type FakeUser = {
  uid: string;
  email: string | null;
  photoURL: string | null;
  displayName: string | null;
  emailVerified: boolean;
};

const fakeUser: FakeUser = {
  uid: 'u1',
  email: 'malin@example.com',
  photoURL: null,
  displayName: 'Malin',
  emailVerified: false,
};

// onAuthStateChanged-callbacken fångas så testen kan driva auth-sekvensen manuellt.
let authCallback: ((u: FakeUser | null) => void) | null = null;
const createUserWithEmailAndPassword = vi.fn(async () => ({ user: fakeUser }));
const sendEmailVerification = vi.fn(async () => {});
const updateProfileMock = vi.fn(async () => {});

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: FakeUser | null) => void) => {
    authCallback = cb;
    return () => {};
  },
  signInWithPopup: vi.fn(async () => {}),
  signInWithEmailAndPassword: vi.fn(async () => {}),
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    (createUserWithEmailAndPassword as (...a: unknown[]) => Promise<{ user: FakeUser }>)(...args),
  sendEmailVerification: (...args: unknown[]) =>
    (sendEmailVerification as (...a: unknown[]) => Promise<void>)(...args),
  updateProfile: (...args: unknown[]) =>
    (updateProfileMock as (...a: unknown[]) => Promise<void>)(...args),
  signOut: vi.fn(async () => {}),
  deleteUser: vi.fn(async () => {}),
  GoogleAuthProvider: class {},
}));

// Mutabelt auth-objekt — testen sätter currentUser innan authCallback drivs så
// account-switch-guarden (auth.currentUser?.uid === firebaseUser.uid) passerar.
// vi.hoisted: config-mockens factory refererar objektet EAGERT (till skillnad
// från de lazy closure-referenserna i övriga mockar).
const authObj = vi.hoisted(() => ({
  currentUser: null as { uid: string; email: string | null; photoURL: string | null; displayName: string | null; emailVerified: boolean } | null,
}));
vi.mock('@/lib/firebase/config', () => ({ auth: authObj }));

// Firestore-kit: path-kodande doc-refs (som WatchlistContext-harnessen) så
// testen kan pinna VILKEN doc som skrivs, + styrbar getDoc för profil-läsningen.
// Args-typen via generiken (inte impl-parametrar) — spelar in call-args för
// payload-assertions utan en oanvänd-param-lintvarning.
const setDoc = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const profileDocData: { current: Record<string, unknown> | null } = { current: null };

// BIN-535: default runTransaction stub re-reads the SAME profileDocData
// mirror the plain getDoc above uses — so the normal (non-racing) create path
// behaves exactly like the old plain setDoc. Individual tests override this
// with mockImplementationOnce to simulate a doc appearing mid-transaction.
const runTransaction = vi.fn(
  async (_db: unknown, updateFn: (tx: { get: (ref: unknown) => Promise<{ exists: () => boolean; data: () => Record<string, unknown> }>; set: (ref: unknown, data: Record<string, unknown>) => void }) => Promise<unknown>) =>
    updateFn({
      get: async () => ({
        exists: () => profileDocData.current !== null,
        data: () => profileDocData.current ?? {},
      }),
      set: (ref: unknown, data: Record<string, unknown>) => { setDoc(ref, data); },
    }),
);

// BIN-536: stub the array-contains query chain updateProviders drives —
// query/where/limit are recorded so a test can assert the bound is applied;
// getDocs always resolves empty (no groups) unless a test overrides it.
const limitCalls: unknown[] = [];
// BIN-587: watchlist-cascaden läser hela collectionen och skriver i batchar —
// docs bär därför ref + data() (som WatchlistContext-harnessen) så testen kan
// pinna VILKA items som stämplas.
type FakeDoc = { id: string; ref: { _path: string }; data: () => Record<string, unknown> };
const getDocsMock = vi.fn<(q: unknown) => Promise<{ docs: FakeDoc[] }>>(async () => ({ docs: [] }));
const batchSets: { ref: { _path: string }; data: Record<string, unknown> }[] = [];
const batchCommit = vi.fn<() => Promise<void>>(async () => {});
const writeBatch = vi.fn(() => ({
  set: (ref: { _path: string }, data: Record<string, unknown>) => { batchSets.push({ ref, data }); },
  commit: () => batchCommit(),
}));

function watchlistDoc(id: string, visibility?: string): FakeDoc {
  return {
    id,
    ref: { _path: `users/u1/watchlist/${id}` },
    data: () => (visibility ? { visibility } : {}),
  };
}

vi.mock('@/lib/firebase/db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
    getDoc: async () => ({
      exists: () => profileDocData.current !== null,
      data: () => profileDocData.current ?? {},
    }),
    setDoc,
    runTransaction,
    collection: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
    getDocs: (q: unknown) => getDocsMock(q),
    query: (...args: unknown[]) => args,
    where: (field: string, op: string, value: unknown) => ({ field, op, value }),
    limit: (n: number) => { limitCalls.push(n); return { _limit: n }; },
    serverTimestamp: () => 'ts',
    writeBatch: () => writeBatch(),
    deleteField: () => '__delete__',
  }),
  getDb: async () => ({}),
  clearFirestorePersistence: vi.fn(async () => {}),
}));

vi.mock('@/lib/firebase/appCheck', () => ({ initAppCheck: async () => {} }));
vi.mock('@/lib/firebase/publicProfile', () => ({ syncMyPublicProfile: vi.fn(async () => {}) }));
vi.mock('@/lib/firebase/userData', () => ({ collectUserDataSnapshots: vi.fn(async () => ({})) }));
vi.mock('@/lib/firebase/accountDeletion', () => ({
  collectDeletionRefs: vi.fn(async () => ({})),
  applyDeletionPlan: vi.fn(async () => {}),
}));
vi.mock('@/lib/firebase/groups', () => ({
  updateMemberProviders: vi.fn(async () => {}),
  refreshMyHouseholdContributions: vi.fn(async () => {}),
  // BIN-536: real value re-declared here (not re-exported from the actual
  // module) since @/lib/firebase/groups is fully mocked in this file —
  // must match groups.ts's real MY_GROUPS_LIMIT so the assertion below
  // stays meaningful instead of testing the mock against itself.
  MY_GROUPS_LIMIT: 100,
}));

// Auto-claim-kedjan (dynamisk import i tryAutoClaimUsername): deterministisk
// suggest + alltid-ledigt basnamn, claimUsername spioneras för orphan-räkning.
const claimUsername = vi.fn(async () => {});
vi.mock('@/lib/firebase/username', () => ({
  suggestUsernameFromIdentity: (name: string | null, email: string | null) => {
    const base = (name ?? email ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return base.length > 0 ? base : null;
  },
  findAvailableUsername: async (base: string) => base,
  claimUsername: (...args: unknown[]) =>
    (claimUsername as (...a: unknown[]) => Promise<void>)(...args),
}));

import { AuthProvider, useAuth } from './AuthContext';

// --- Harness -----------------------------------------------------------------

let ctx: ReturnType<typeof useAuth> | null = null;

function Harness() {
  const value = useAuth();
  useEffect(() => { ctx = value; }, [value]);
  return <div>ready</div>;
}

function renderAuth() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

// Driv inloggningssekvensen: profil-docen som getDoc ska svara med, sen
// authCallback (fångad efter att initAppCheck-microtasken flushats).
async function login(profileData: Record<string, unknown> | null) {
  profileDocData.current = profileData;
  authObj.currentUser = fakeUser;
  await act(async () => {}); // flusha initAppCheck().then(subscribe)
  expect(authCallback).not.toBeNull();
  await act(async () => { authCallback!(fakeUser); });
}

function userDocWrites() {
  return setDoc.mock.calls.filter(c => (c[0] as { _path: string })._path === 'users/u1');
}

beforeEach(() => {
  setDoc.mockReset();
  setDoc.mockImplementation(async () => {});
  runTransaction.mockClear();
  getDocsMock.mockClear();
  getDocsMock.mockImplementation(async () => ({ docs: [] }));
  batchSets.length = 0;
  batchCommit.mockReset();
  batchCommit.mockImplementation(async () => {});
  // mockReset (inte mockClear): ett test som byter ut batch-fabriken ska inte
  // läcka den vidare till nästa — reset återställer vi.fn:ens original-impl.
  writeBatch.mockReset();
  limitCalls.length = 0;
  createUserWithEmailAndPassword.mockClear();
  sendEmailVerification.mockClear();
  updateProfileMock.mockClear();
  claimUsername.mockClear();
  authCallback = null;
  authObj.currentUser = null;
  profileDocData.current = null;
  ctx = null;
  try { window.localStorage.clear(); } catch { /* private mode */ }
});

// BIN-517: register()-writen racear onAuthStateChanged → ensureUserProfile →
// tryAutoClaimUsername. Med merge:true får payloaden ALDRIG innehålla en
// explicit `username`-nyckel — en null hade klobbrat ett just-claimat username
// tillbaka till null medan usernames/{name}-reservationen stod kvar (orphan).
describe('AuthContext — register() username-klobbring (BIN-517)', () => {
  it("register()'s setDoc payload never contains a username key", async () => {
    renderAuth();
    await act(async () => {}); // låt provider-effekterna montera

    await act(async () => {
      await ctx!.register('malin@example.com', 'hemligt-lösenord', 'Malin', '2026-01');
    });

    const writes = userDocWrites();
    expect(writes).toHaveLength(1);
    const [, payload, opts] = writes[0] as [unknown, Record<string, unknown>, unknown];
    expect('username' in payload).toBe(false); // själva BIN-517-invarianten
    expect(opts).toEqual({ merge: true });     // merge:true är det som gör frånvaron säker
    // Sanity: writen bär fortfarande terms-metadatan som motiverar att den finns.
    expect(payload.termsVersion).toBe('2026-01');
    expect(payload.termsAcceptedAt).toBe('ts');
    expect(sendEmailVerification).toHaveBeenCalledTimes(1);
  });

  it('a registered user ends up with a non-null username and exactly ONE usernames/{name} reservation', async () => {
    renderAuth();
    await act(async () => {});

    await act(async () => {
      await ctx!.register('malin@example.com', 'hemligt-lösenord', 'Malin', '2026-01');
    });

    // onAuthStateChanged landar nu; getDoc svarar med den doc register() skrev
    // (inget username-fält alls) → ensureUserProfile-backfillen auto-claimar.
    const registered = userDocWrites()[0][1] as Record<string, unknown>;
    // Mockens serverTimestamp-sentinel ('ts') saknar .toDate(); riktiga läsare
    // får Firestore-Timestamps. Frånvarande fält tar samma ??-fallback-väg.
    const readBack = { ...registered };
    for (const k of ['createdAt', 'updatedAt', 'termsAcceptedAt', 'ageConfirmedAt']) delete readBack[k];
    await login(readBack);

    expect(ctx!.user?.username).toBe('malin');
    // Exakt EN reservation — hade register() skrivit username:null hade nästa
    // sign-in claimat igen och lämnat den första usernames-docen som orphan.
    expect(claimUsername).toHaveBeenCalledTimes(1);
    expect(claimUsername).toHaveBeenCalledWith('u1', 'malin', null);
    // Och register-writen klobbrade aldrig fältet (samma invariant som ovan).
    expect('username' in registered).toBe(false);
  });
});

// BIN-516: den synkrona spegel-ref:en (BIN-40-mönstret) uppdaterades FÖRE
// await:en och återställdes aldrig vid write-fel — ett avvisat värde smyg-
// persisterades då via nästa lyckade edits spread. Rollbacken måste utesluta
// det avvisade värdet ur efterföljande payloads.
describe('AuthContext — setProviderCost/setProviderCampaign rollback vid write-fel (BIN-516)', () => {
  it('setProviderCost: a rejected cost is excluded from the next successful write to a DIFFERENT provider', async () => {
    renderAuth();
    await login({ username: 'malin', providerCosts: { 8: 100 } });

    // Edit mot provider 76 avvisas av Firestore.
    setDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await act(async () => {
      await expect(ctx!.setProviderCost(76, 129)).rejects.toThrow('permission-denied');
    });

    // Nästa lyckade edit (annan provider) får INTE bära med sig 76:an.
    await act(async () => {
      await ctx!.setProviderCost(8, 149);
    });

    const [, payload] = setDoc.mock.calls.at(-1)! as [unknown, Record<string, unknown>];
    const costs = payload.providerCosts as Record<number, number>;
    expect(costs).toEqual({ 8: 149 }); // det avvisade 76:129 är borta
    expect(76 in costs).toBe(false);
  });

  it('setProviderCampaign: a rejected campaign is excluded from the next successful write to a DIFFERENT provider', async () => {
    renderAuth();
    await login({ username: 'malin', providerCampaigns: {} });

    const rejected = { monthlyCost: 29, endDate: '2026-10-01' };
    setDoc.mockRejectedValueOnce(new Error('unavailable'));
    await act(async () => {
      await expect(ctx!.setProviderCampaign(8, rejected)).rejects.toThrow('unavailable');
    });

    const accepted = { monthlyCost: 59, endDate: '2026-12-01' };
    await act(async () => {
      await ctx!.setProviderCampaign(76, accepted);
    });

    const [, payload] = setDoc.mock.calls.at(-1)! as [unknown, Record<string, unknown>];
    const campaigns = payload.providerCampaigns as Record<number, unknown>;
    expect(campaigns).toEqual({ 76: accepted }); // 8:ans avvisade kampanj är borta
    expect(8 in campaigns).toBe(false);
  });

  it('the successful-write happy path still merges against the latest mirror (BIN-40 unbroken)', async () => {
    renderAuth();
    await login({ username: 'malin', providerCosts: { 8: 100 } });

    // Två snabba edits mot OLIKA providers — båda ska landa (spegeln, inte
    // render-snapshoten, är merge-basen).
    await act(async () => {
      await ctx!.setProviderCost(76, 129);
      await ctx!.setProviderCost(337, 109);
    });

    const [, payload] = setDoc.mock.calls.at(-1)! as [unknown, Record<string, unknown>];
    expect(payload.providerCosts).toEqual({ 8: 100, 76: 129, 337: 109 });
  });
});

// BIN-531: setProviderRenewalDay shared the same mirror-ref-poisoning pattern
// BIN-516 fixed in setProviderCost/setProviderCampaign — same test shape.
describe('AuthContext — setProviderRenewalDay rollback vid write-fel (BIN-531)', () => {
  it('a rejected renewal day is excluded from the next successful write to a DIFFERENT provider', async () => {
    renderAuth();
    await login({ username: 'malin', providerRenewalDays: { 8: 5 } });

    setDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await act(async () => {
      await expect(ctx!.setProviderRenewalDay(76, 20)).rejects.toThrow('permission-denied');
    });

    await act(async () => {
      await ctx!.setProviderRenewalDay(8, 12);
    });

    const [, payload] = setDoc.mock.calls.at(-1)! as [unknown, Record<string, unknown>];
    const days = payload.providerRenewalDays as Record<number, number>;
    expect(days).toEqual({ 8: 12 }); // det avvisade 76:20 är borta
    expect(76 in days).toBe(false);
  });

  it('the successful-write happy path still merges against the latest mirror', async () => {
    renderAuth();
    await login({ username: 'malin', providerRenewalDays: { 8: 5 } });

    await act(async () => {
      await ctx!.setProviderRenewalDay(76, 20);
      await ctx!.setProviderRenewalDay(337, 1);
    });

    const [, payload] = setDoc.mock.calls.at(-1)! as [unknown, Record<string, unknown>];
    expect(payload.providerRenewalDays).toEqual({ 8: 5, 76: 20, 337: 1 });
  });
});

// BIN-535: the create-branch of ensureUserProfile races register()'s own
// setDoc on the same users/{uid} doc (createUserWithEmailAndPassword fires
// onAuthStateChanged before register()'s write lands). The transaction wrap
// must detect a doc that appeared since the initial getDoc and fall back to
// the existing-profile path instead of overwriting it.
describe('AuthContext — ensureUserProfile create-branch race (BIN-535)', () => {
  it('creates a fresh profile via transaction when no doc exists and no race occurs', async () => {
    renderAuth();
    await login(null); // no doc at all — exercises the create branch end to end

    expect(ctx!.user?.displayName).toBe('Malin');
    expect(ctx!.user?.username).toBe('malin'); // auto-claimed on creation
    expect(runTransaction).toHaveBeenCalledTimes(1);
    const writes = userDocWrites();
    expect(writes.length).toBeGreaterThan(0); // the tx.set() write landed
  });

  it('a doc concurrently created (e.g. by register()) between the initial read and the transaction is never overwritten', async () => {
    renderAuth();
    await act(async () => {});

    // Initial getDoc (outside the transaction) sees no doc.
    profileDocData.current = null;
    authObj.currentUser = fakeUser;

    // Simulate register()'s write landing exactly as the transaction starts:
    // its data reaches Firestore between our getDoc and the transaction's
    // own read, so tx.get() must see it — and must NOT be overwritten.
    const racedDoc = {
      displayName: 'Malin',
      email: 'malin@example.com',
      photoURL: null,
      // An OLDER version than CURRENT_TERMS_VERSION proves this is register()'s
      // real value surviving, not ensureUserProfile's Google-sign-in default.
      termsVersion: '2025-11',
    };
    runTransaction.mockImplementationOnce(async (_db: unknown, updateFn: (tx: { get: () => Promise<{ exists: () => boolean; data: () => Record<string, unknown> }>; set: () => void }) => Promise<unknown>) =>
      updateFn({
        get: async () => ({ exists: () => true, data: () => racedDoc }),
        set: () => { throw new Error('must not write — would clobber the concurrently-created doc'); },
      }),
    );

    await act(async () => { authCallback!(fakeUser); });
    await act(async () => {});

    expect(ctx!.user?.termsVersion).toBe('2025-11'); // register()'s value survived
    expect(ctx!.user?.displayName).toBe('Malin');
  });
});

// BIN-587: the visibility cascade used to swallow its own failure — the profile
// said 'private' while every un-restamped item still carried
// effectiveVisibility:'public', and the read rule trusts that field. The failure
// must now be recorded (flag on the profile), surfaced, and retried on load.
describe('AuthContext — failed visibility cascade no longer fails open (BIN-587)', () => {
  function flagWrites() {
    return userDocWrites()
      .map(c => c[1] as Record<string, unknown>)
      .filter(p => 'visibilitySyncPending' in p);
  }

  it('a successful downgrade stamps every override-free item and records no pending flag', async () => {
    renderAuth();
    await login({ username: 'malin', defaultVisibility: 'public', isPublic: true });
    // m2 har en egen per-item-override och ska INTE röras av cascaden.
    getDocsMock.mockImplementation(async () => ({ docs: [watchlistDoc('m1'), watchlistDoc('m2', 'public')] }));

    await act(async () => { await ctx!.updateDefaultVisibility('private'); });

    expect(batchSets).toEqual([
      { ref: { _path: 'users/u1/watchlist/m1' }, data: { effectiveVisibility: 'private', isPublic: false } },
    ]);
    expect(ctx!.visibilitySyncPending).toBe(false);
    expect(flagWrites()).toHaveLength(0); // ingen extra write på happy path
  });

  it('records visibilitySyncPending on the profile when the item cascade throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAuth();
    await login({ username: 'malin', defaultVisibility: 'public', isPublic: true });
    getDocsMock.mockImplementation(async () => ({ docs: [watchlistDoc('m1')] }));
    batchCommit.mockRejectedValueOnce(new Error('unavailable'));

    await act(async () => { await ctx!.updateDefaultVisibility('private'); });

    expect(ctx!.visibilitySyncPending).toBe(true);
    expect(flagWrites().map(p => p.visibilitySyncPending)).toEqual([true]);
    // Profil-writen (steg 1) landade — det är just den som gör att UI:t annars
    // hade påstått att användaren är privat.
    const profileWrite = userDocWrites().map(c => c[1] as Record<string, unknown>)
      .find(p => p.defaultVisibility === 'private');
    expect(profileWrite?.isPublic).toBe(false);
    // Ingen tight retry-loop i samma session: exakt EN cascade-läsning.
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('retries the cascade on the next app load and clears the flag when it succeeds', async () => {
    renderAuth();
    getDocsMock.mockImplementation(async () => ({ docs: [watchlistDoc('m1')] }));
    // Profilen bär flaggan från förra sessionen; defaultVisibility är sanningen.
    await login({
      username: 'malin',
      defaultVisibility: 'private',
      isPublic: false,
      visibilitySyncPending: true,
    });
    await act(async () => {}); // låt retry-effekten köra klart

    expect(batchSets).toEqual([
      { ref: { _path: 'users/u1/watchlist/m1' }, data: { effectiveVisibility: 'private', isPublic: false } },
    ]);
    expect(ctx!.visibilitySyncPending).toBe(false);
    expect(flagWrites().map(p => p.visibilitySyncPending)).toEqual(['__delete__']);
  });

  it('keeps the flag when the retry fails too, so a later load tries again', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAuth();
    getDocsMock.mockImplementation(async () => ({ docs: [watchlistDoc('m1')] }));
    batchCommit.mockRejectedValue(new Error('unavailable'));
    await login({
      username: 'malin',
      defaultVisibility: 'private',
      isPublic: false,
      visibilitySyncPending: true,
    });
    await act(async () => {});

    expect(ctx!.visibilitySyncPending).toBe(true);
    expect(flagWrites()).toHaveLength(0); // flaggan stod redan satt — ingen onödig write
    errSpy.mockRestore();
  });

  // Auto-omförsöket och ett manuellt val stämplar SAMMA docs. Utan ordning
  // avgörs slutvärdet av vilken batch som landar sist — omförsökets gamla
  // 'public' kunde skriva över ett nyss valt 'private' OCH rensa varningen, dvs
  // exakt det fails-open-läge BIN-587 stängde, återöppnat en nivå upp.
  it('a newer manual choice wins over an in-flight auto-retry, and only it clears the flag', async () => {
    const timeline: string[] = [];
    renderAuth();
    getDocsMock.mockImplementation(async () => ({ docs: [watchlistDoc('m1')] }));
    // Håll omförsökets commit öppen så det manuella valet hinner göras medan
    // den gamla stämplingen fortfarande är i luften. Varje batch spårar SINA
    // egna sets, så tidslinjen märks med rätt värde även i det överlappande
    // (trasiga) läget testet ska fånga.
    let releaseRetry = () => {};
    const retryCommit = new Promise<void>(res => { releaseRetry = () => res(); });
    let batches = 0;
    writeBatch.mockImplementation(() => {
      const mine: Record<string, unknown>[] = [];
      const isRetryBatch = ++batches === 1;
      return {
        set: (ref: { _path: string }, data: Record<string, unknown>) => {
          mine.push(data);
          batchSets.push({ ref, data });
        },
        commit: async () => {
          if (isRetryBatch) await retryCommit;
          timeline.push(`commit:${String(mine[0]?.effectiveVisibility)}`);
        },
      };
    });
    setDoc.mockImplementation(async (_ref: unknown, payload: unknown) => {
      const p = payload as Record<string, unknown>;
      if ('visibilitySyncPending' in p) timeline.push(`flag:${String(p.visibilitySyncPending)}`);
    });

    await login({
      username: 'malin',
      defaultVisibility: 'public',
      isPublic: true,
      visibilitySyncPending: true,
    });

    let manual: Promise<void>;
    await act(async () => { manual = ctx!.updateDefaultVisibility('private'); });
    releaseRetry();
    await act(async () => { await manual; });

    // Den gamla stämplingen får landa, men det VALDA värdet skrivs sist…
    expect(timeline).toEqual(['commit:public', 'commit:private', 'flag:__delete__']);
    // …och "synkat" rapporteras bara om det värdet, aldrig om det ersatta.
    expect(batchSets[batchSets.length - 1].data).toEqual({ effectiveVisibility: 'private', isPublic: false });
    expect(ctx!.visibilitySyncPending).toBe(false);
  });
});

// BIN-617: the auto-repair is latched to ONE attempt per uid per app load
// (`visibilityRetriedFor`), and sign-out is the only way a load starts over
// without a page reload. The latch survived it, so signing out and back in as the
// same uid inherited a spent attempt: the pending flag stayed, the Settings
// warning stayed, and only the manual "Försök igen nu" could clear it.
//
// BIN-631: the first attempt at this test raced a mock-call count against a
// promise chain nobody awaited, and it was flaky. This one awaits the CHAIN — the
// flag-write is the last link in it, so the test resolves when the retry has
// genuinely finished. A regression cannot make it pass early; it makes it fail.
describe('AuthContext — the visibility retry latch resets on sign-out (BIN-617)', () => {
  // Awaits a REAL link of the retry chain, with a deadline that can only fire in
  // the BROKEN world: on the fixed code the chain settles on microtasks, orders of
  // magnitude below this. Without it a regression surfaces as vitest's generic 5 s
  // timeout, which strands the following tests mid-`act` and reports failures in
  // files this change never touched.
  function withDeadline(p: Promise<void>, what: string, ms = 2000): Promise<void> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      p.finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
      }),
    ]);
  }

  it('a same-session sign-out → sign-in as the same uid gets its own auto-retry', async () => {
    // Both ends of the chain are AWAITED, never polled and never counted against a
    // fixed number of flushes:
    //   a failing retry ends in the effect's own console.error handler,
    //   a succeeding one ends in markVisibilitySyncPending's profile write.
    let retryFailed: (() => void) | null = null;
    const firstFailed = new Promise<void>(res => { retryFailed = res; });
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('visibilitySyncPending retry')) retryFailed?.();
    });
    let flagWritten: (() => void) | null = null;
    const nextFlagWrite = () => new Promise<void>(res => { flagWritten = res; });
    setDoc.mockImplementation(async (_ref: unknown, payload: unknown) => {
      if ('visibilitySyncPending' in (payload as Record<string, unknown>)) flagWritten?.();
    });
    getDocsMock.mockImplementation(async () => ({ docs: [watchlistDoc('m1')] }));

    // Session 1: the profile carries last session's pending flag, and this load's
    // one retry FAILS — so the latch is spent and the flag stays set. (No flag
    // WRITE here: the flag is already true on the profile, and BIN-587
    // deliberately does not rewrite it.)
    batchCommit.mockRejectedValue(new Error('unavailable'));
    renderAuth();
    await login({
      username: 'malin',
      defaultVisibility: 'private',
      isPublic: false,
      visibilitySyncPending: true,
    });
    await act(async () => { await withDeadline(firstFailed, "the first (failing) auto-retry"); });
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    expect(ctx!.visibilitySyncPending).toBe(true);

    // Sign out, then straight back in as the SAME uid — no page reload, so the
    // latch is the only thing that could stop the second attempt.
    await act(async () => {
      authObj.currentUser = null;
      authCallback!(null);
    });
    expect(ctx!.visibilitySyncPending).toBe(false); // per-user state cleared

    batchCommit.mockReset();
    batchCommit.mockImplementation(async () => {}); // this time the cascade works
    const secondCleared = nextFlagWrite();
    await login({
      username: 'malin',
      defaultVisibility: 'private',
      isPublic: false,
      visibilitySyncPending: true,
    });
    await act(async () => { await withDeadline(secondCleared, "the post-sign-in auto-retry to clear the flag"); });

    // A SECOND cascade actually ran (the latch let go)…
    expect(getDocsMock).toHaveBeenCalledTimes(2);
    expect(batchSets.at(-1)).toEqual({
      ref: { _path: 'users/u1/watchlist/m1' },
      data: { effectiveVisibility: 'private', isPublic: false },
    });
    // …and it repaired the account: the flag is deleted from the profile doc.
    expect(ctx!.visibilitySyncPending).toBe(false);
    const flagPayloads = userDocWrites()
      .map(c => c[1] as Record<string, unknown>)
      .filter(p => 'visibilitySyncPending' in p)
      .map(p => p.visibilitySyncPending);
    expect(flagPayloads).toEqual(['__delete__']);
    errSpy.mockRestore();
  });

  it('WITHOUT a sign-out the latch still holds — one automatic attempt per load', async () => {
    // The other half, and the reason the reset belongs in the signed-OUT branch
    // specifically: BIN-587 spends the attempt deliberately so a cascade that
    // keeps failing cannot loop against Firestore (billing reads) all session.
    // Clearing the latch anywhere the profile is re-read would undo that.
    let retryFailed: (() => void) | null = null;
    const firstFailed = new Promise<void>(res => { retryFailed = res; });
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('visibilitySyncPending retry')) retryFailed?.();
    });
    getDocsMock.mockImplementation(async () => ({ docs: [watchlistDoc('m1')] }));
    batchCommit.mockRejectedValue(new Error('unavailable'));

    renderAuth();
    await login({
      username: 'malin',
      defaultVisibility: 'private',
      isPublic: false,
      visibilitySyncPending: true,
    });
    await act(async () => { await withDeadline(firstFailed, "the first (failing) auto-retry"); });
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    // Still signed in; the profile is re-read and now reports a DIFFERENT target,
    // which really does re-run the retry effect (its deps are the values, so a
    // re-read alone would not). Only the latch stops a second cascade here.
    profileDocData.current = {
      username: 'malin',
      defaultVisibility: 'public',
      isPublic: true,
      visibilitySyncPending: true,
    };
    await act(async () => { authCallback!(fakeUser); });
    await act(async () => {});
    await act(async () => {});

    expect(getDocsMock).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

// BIN-536: updateProviders' array-contains group query had the same unbounded
// shape BIN-510 flagged in groups.ts, and now shares groups.ts's real
// MY_GROUPS_LIMIT constant (imported via the dynamic import) instead of a
// separately-invented value, so the two call sites can't drift apart.
describe('AuthContext — updateProviders group query bound (BIN-536)', () => {
  it('bounds the array-contains group query with the shared MY_GROUPS_LIMIT', async () => {
    renderAuth();
    await login({ username: 'malin', myProviders: [] });

    await act(async () => {
      await ctx!.updateProviders([8, 76]);
    });

    expect(limitCalls).toContain(100);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });
});
