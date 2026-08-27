import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
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
  // BIN-909: the ONLY thing separating a genuinely new sign-up from a returning
  // account whose profile is gone. Mutable so a test can drive both.
  metadata: { creationTime: string | undefined };
};

const fakeUser: FakeUser = {
  uid: 'u1',
  email: 'malin@example.com',
  photoURL: null,
  displayName: 'Malin',
  emailVerified: false,
  metadata: { creationTime: new Date().toUTCString() },
};

// onAuthStateChanged-callbacken fångas så testen kan driva auth-sekvensen manuellt.
let authCallback: ((u: FakeUser | null) => void) | null = null;
const createUserWithEmailAndPassword = vi.fn(async () => ({ user: fakeUser }));
const sendEmailVerification = vi.fn(async () => {});
const updateProfileMock = vi.fn(async () => {});
// BIN-669/732: controllable, so a test can make the sign-out REJECT and still
// assert the remembered path is gone. An inline `vi.fn(async () => {})` in the
// factory below could not, which is why the failure path shipped untested the
// first time.
const signOutMock = vi.fn(async () => {});
// Säkerhetsgranskning 2026-08-05: deleteAccount's pre-flight freshness gate and
// the auth deletion it gates. Both controllable, because the whole point of the
// fix is WHICH of them runs first when the session is stale.
const deleteUserMock = vi.fn(async () => {});
const authTime: { current: string } = { current: new Date().toUTCString() };
const getIdTokenResultMock = vi.fn(async () => ({ authTime: authTime.current }));

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
  signOut: (...args: unknown[]) => (signOutMock as (...a: unknown[]) => Promise<void>)(...args),
  deleteUser: (...args: unknown[]) => (deleteUserMock as (...a: unknown[]) => Promise<void>)(...args),
  getIdTokenResult: (...args: unknown[]) =>
    (getIdTokenResultMock as (...a: unknown[]) => Promise<{ authTime: string }>)(...args),
  GoogleAuthProvider: class {},
}));

// Mutabelt auth-objekt — testen sätter currentUser innan authCallback drivs så
// account-switch-guarden (auth.currentUser?.uid === firebaseUser.uid) passerar.
// vi.hoisted: config-mockens factory refererar objektet EAGERT (till skillnad
// från de lazy closure-referenserna i övriga mockar).
const authObj = vi.hoisted(() => ({
  currentUser: null as { uid: string; email: string | null; photoURL: string | null; displayName: string | null; emailVerified: boolean; metadata: { creationTime: string | undefined } } | null,
}));
vi.mock('@/lib/firebase/config', () => ({ auth: authObj }));

// Firestore-kit: path-kodande doc-refs (som WatchlistContext-harnessen) så
// testen kan pinna VILKEN doc som skrivs, + styrbar getDoc för profil-läsningen.
// Args-typen via generiken (inte impl-parametrar) — spelar in call-args för
// payload-assertions utan en oanvänd-param-lintvarning.
const setDoc = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const profileDocData: { current: Record<string, unknown> | null } = { current: null };
const profileGate: { current: Promise<void> | null } = { current: null };

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
// BIN-942: `update` is what the cascade calls now — `set(…, {merge:true})` against a
// snapshot ref is a CREATE when the title was deleted mid-cascade, which is the ghost this
// ticket removes. Both land in the SAME `batchSets` array on purpose, so the five BIN-587
// assertions below still read what the cascade wrote without a single word changed; the
// `batchWriteKinds` tally beside it is what pins WHICH method was used.
const batchWriteKinds: string[] = [];
const writeBatch = vi.fn(() => ({
  set: (ref: { _path: string }, data: Record<string, unknown>) => {
    batchWriteKinds.push('set');
    batchSets.push({ ref, data });
  },
  update: (ref: { _path: string }, data: Record<string, unknown>) => {
    batchWriteKinds.push('update');
    batchSets.push({ ref, data });
  },
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
    getDoc: async () => {
      // BIN-816: a hold point for the profile read, so a test can drive the
      // interleaving the marker re-read exists for — a storage event landing
      // WHILE ensureUserProfile is in flight, then the stale sample resolving
      // on top of it. Null by default, so every other test is unaffected.
      if (profileGate.current) await profileGate.current;
      return {
        exists: () => profileDocData.current !== null,
        data: () => profileDocData.current ?? {},
      };
    },
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
// Hoisted for the same reason as `deletion` above: BIN-817's assertions are that
// clearPublicProfileSignature was NOT reached on every guarded abort, and an inline
// vi.fn() inside the factory is unreachable from the test body.
const publicProfile = vi.hoisted(() => ({
  syncMyPublicProfile: vi.fn(async () => {}),
  clearPublicProfileSignature: vi.fn(() => {}),
}));
vi.mock('@/lib/firebase/publicProfile', () => ({
  syncMyPublicProfile: publicProfile.syncMyPublicProfile,
  clearPublicProfileSignature: publicProfile.clearPublicProfileSignature,
}));
// BIN-844: hoisted for the same reason as the rest — the load-bearing assertions
// are about ORDER (push must be unregistered BEFORE the Auth sign-out, because the
// Firestore delete needs a live token) and about NOT being reached on a guarded
// abort. An inline spy can express neither.
const pushCleanup = vi.hoisted(() => ({
  disablePushForUser: vi.fn(async () => {}),
  clearLocalPushTokenId: vi.fn(() => {}),
  // Defaults to TRUE so the sign-out path is actually exercised; a test that wants
  // the no-token case says so explicitly. Defaulting to false would make every
  // ordering assertion below vacuous.
  hasLocalPushToken: vi.fn(() => true),
}));
vi.mock('@/lib/firebase/messaging', () => ({
  disablePushForUser: pushCleanup.disablePushForUser,
  clearLocalPushTokenId: pushCleanup.clearLocalPushTokenId,
  hasLocalPushToken: pushCleanup.hasLocalPushToken,
}));
const inviteCache = vi.hoisted(() => ({ clearAllInviteTokens: vi.fn(() => {}) }));
vi.mock('@/lib/groupInviteCache', () => ({
  clearAllInviteTokens: inviteCache.clearAllInviteTokens,
}));
// Säkerhetsgranskning 2026-08-05: hoisted rather than inline vi.fn()s inside the
// factories, because the assertion the fix needs is that these were NOT reached —
// an inline spy is unreachable from the test body, which is why the ordering
// shipped unpinned.
const deletion = vi.hoisted(() => ({
  collectUserDataSnapshots: vi.fn(async () => ({})),
  collectDeletionRefs: vi.fn(async () => ({})),
  applyDeletionPlan: vi.fn(async () => {}),
}));
vi.mock('@/lib/firebase/userData', () => ({
  collectUserDataSnapshots: deletion.collectUserDataSnapshots,
}));
vi.mock('@/lib/firebase/accountDeletion', () => ({
  collectDeletionRefs: deletion.collectDeletionRefs,
  applyDeletionPlan: deletion.applyDeletionPlan,
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

// BIN-748: the provider and AuthGuard are rendered TOGETHER at the end of this
// file, because the fix is a contract between them — the provider writes which
// page the tab is showing a session on, the guard reads it — and neither file's
// own harness can observe both halves. ONE router object, not a fresh one per
// call — a new identity each render re-fires the guard's effect and would make
// "it only decides once" vacuous. `usePathname` is the provider's write side, so
// it is a settable value rather than a constant.
const router = vi.hoisted(() => ({ push: vi.fn() }));
const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => nav.pathname,
}));

import AuthGuard from '@/components/AuthGuard';
import { AuthProvider, useAuth } from './AuthContext';
import { REQUIRES_RECENT_LOGIN, STALE_SESSION_PREFLIGHT, classifyDeletionFailure } from '@/lib/authErrors';
import { CURRENT_TERMS_VERSION } from '@/lib/legal';

// --- Harness -----------------------------------------------------------------

let ctx: ReturnType<typeof useAuth> | null = null;
// BIN-816: every RENDER's value of the limbo flag, in order. `ctx` is written in
// an effect, so it lags a render behind — and the bug this guards against (the
// limbo screen appearing during a normal deletion) is precisely a render that
// happens and then goes away again. Reading `ctx` mid-cascade cannot see it.
const deletionFlagRenders: boolean[] = [];

// BIN-909 — every render's value of the gate flag, same shape as `deletionFlagRenders`.
const reconsentFlagRenders: boolean[] = [];

function Harness() {
  const value = useAuth();
  deletionFlagRenders.push(value.deletionInProgress);
  reconsentFlagRenders.push(value.pendingReconsent);
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
  reconsentFlagRenders.length = 0;
  // BIN-909: default every test to a brand-new account, so only the tests that
  // deliberately age it reach the gate.
  fakeUser.metadata.creationTime = new Date().toUTCString();
  setDoc.mockReset();
  setDoc.mockImplementation(async () => {});
  runTransaction.mockClear();
  getDocsMock.mockClear();
  getDocsMock.mockImplementation(async () => ({ docs: [] }));
  batchSets.length = 0;
  batchWriteKinds.length = 0;
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
  // BIN-844: the one mock in this block that was never cleared, which is why the
  // new ordering tests had to compensate with `.at(-1)`. Cleared for parity.
  signOutMock.mockClear();
  deleteUserMock.mockClear();
  getIdTokenResultMock.mockClear();
  deletion.collectUserDataSnapshots.mockClear();
  deletion.collectDeletionRefs.mockClear();
  deletion.applyDeletionPlan.mockClear();
  publicProfile.clearPublicProfileSignature.mockClear();
  // BIN-816: the projection-sync effect is the second resurrection path, so a
  // test now asserts it was NOT reached. Its sibling above was cleared and this
  // one was not — calls leaked across the whole file, which makes any
  // not-called assertion on it vacuous.
  publicProfile.syncMyPublicProfile.mockClear();
  pushCleanup.disablePushForUser.mockClear();
  pushCleanup.disablePushForUser.mockImplementation(async () => {});
  pushCleanup.clearLocalPushTokenId.mockClear();
  pushCleanup.hasLocalPushToken.mockClear();
  pushCleanup.hasLocalPushToken.mockImplementation(() => true);
  inviteCache.clearAllInviteTokens.mockClear();
  authTime.current = new Date().toUTCString(); // fresh session unless a test ages it
  authCallback = null;
  deletionFlagRenders.length = 0;
  authObj.currentUser = null;
  profileDocData.current = null;
  profileGate.current = null;
  ctx = null;
  router.push.mockClear();
  nav.pathname = '/';
  window.history.replaceState({}, '', '/');
  try { window.localStorage.clear(); } catch { /* private mode */ }
  // BIN-732: the remembered return path lives here, and a leftover from a
  // neighbouring test would make "the path survived" pass for the wrong reason.
  try { window.sessionStorage.clear(); } catch { /* private mode */ }
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

  // BIN-942. The whole fix is one method name, so this is the assertion that carries it.
  // `set(…, { merge: true })` against a snapshot ref is a CREATE when the title was deleted
  // between `getDocs` and `commit` — the deleted title comes back as a two-field ghost on
  // the publicly-readable path. `update` cannot create; Firestore enforces the existence
  // precondition regardless of the rules, so this closes the cascade's own race on
  // code-deploy alone, before the rules floor ships.
  it('the cascade writes with update, never with set — a deleted title cannot be resurrected', async () => {
    renderAuth();
    await login({ username: 'malin', defaultVisibility: 'private', isPublic: false });
    getDocsMock.mockImplementation(async () => ({ docs: [watchlistDoc('m1'), watchlistDoc('m2')] }));

    await act(async () => { await ctx!.updateDefaultVisibility('public'); });

    expect(batchWriteKinds).toEqual(['update', 'update']);
    expect(batchWriteKinds).not.toContain('set');
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
      // BIN-942: same shape as the module-level mock — the cascade calls `update` now,
      // and this local override has to follow or the whole interleaving test throws
      // "update is not a function" instead of exercising the race it is about.
      const record = (ref: { _path: string }, data: Record<string, unknown>) => {
        mine.push(data);
        batchSets.push({ ref, data });
      };
      return {
        set: record,
        update: record,
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

// BIN-669 stopped AuthGuard storing the DEPARTING user's private page as the
// next account's return path — but through a flag raised by `signOut()`, which
// is one tab's memory. Firebase broadcasts a sign-out to every tab on the
// origin, so a second tab parked on a guarded page had a `false` flag and stored
// the page anyway; on a shared device the next account inherits it, and a
// remembered path outlives onboarding. BIN-732 moves the decision onto the
// TRANSITION — uid going set→null, whatever caused it and in whichever tab —
// which is the only signal that actually crosses tabs.
describe('AuthContext — a session ending forgets the return path (BIN-732)', () => {
  const NEXT_KEY = 'binge:nextAfterLogin';
  const stored = () => window.sessionStorage.getItem(NEXT_KEY);

  it('clears a remembered path when uid goes set→null, with no signOut() call in this tab', async () => {
    // THE regression. This provider never runs `signOut` — it only receives the
    // sign-out another tab performed, exactly as the second tab does in life.
    renderAuth();
    await login({ username: 'malin' });
    window.sessionStorage.setItem(NEXT_KEY, '/grupper/g-hemlig-123/');

    await act(async () => {
      authObj.currentUser = null;
      authCallback!(null);
    });

    expect(stored()).toBeNull();
    expect(ctx!.uid).toBeNull();
  });

  it('leaves a path alone on a signed-out BOOT, where uid was never set', async () => {
    // The negative that makes the transition the right signal rather than "uid
    // is null". A signed-out visitor taps the poster badge, the path is stored,
    // /login loads — and Firebase then reports "no session" for the first time.
    // Clearing on that verdict would break the funnel from the 25k prerendered
    // title pages (BIN-645) for every visitor, every time.
    renderAuth();
    await act(async () => {}); // flusha initAppCheck().then(subscribe)
    window.sessionStorage.setItem(NEXT_KEY, '/movie/603/');

    await act(async () => { authCallback!(null); });

    expect(stored()).toBe('/movie/603/');
  });

  it('re-arms: a SECOND session ending clears again', async () => {
    // The transition is per session, not once per tab. Sign out, sign back in,
    // sign out again — the third step has to forget too, or the protection
    // quietly expires after the first handover of the tab's life.
    renderAuth();
    await login({ username: 'malin' });
    await act(async () => {
      authObj.currentUser = null;
      authCallback!(null);
    });

    await login({ username: 'malin' });
    window.sessionStorage.setItem(NEXT_KEY, '/installningar/');
    await act(async () => {
      authObj.currentUser = null;
      authCallback!(null);
    });

    expect(stored()).toBeNull();
  });

  it('signOut() drops the path itself, without waiting for the listener', async () => {
    // Belt to the listener's braces, and not redundant: the clear here is
    // synchronous with the visitor's click, while the listener's is a network
    // round-trip away — and never arrives at all if the sign-out fails.
    window.sessionStorage.setItem(NEXT_KEY, '/grupper/g-hemlig-123/');
    renderAuth();
    await login({ username: 'malin' });
    // The auth listener deliberately does NOT fire here, so only signOut's own
    // clear can satisfy this.
    await act(async () => { await ctx!.signOut(); });

    expect(stored()).toBeNull();
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  // BIN-844. The real shared-device leak was never the invite link — it was that
  // signing out unregistered nothing, so the departing user's notifications kept
  // arriving on the machine. Two orderings carry the fix and both are easy to get
  // wrong, so both are pinned: the uid must be read BEFORE firebaseSignOut (it is
  // null afterwards) and the Firestore delete must happen BEFORE it too (afterwards
  // the client has no credentials for that write).
  it('unregisters push BEFORE the Auth sign-out, with the departing uid', async () => {
    renderAuth();
    await login({ username: 'malin' });

    await act(async () => { await ctx!.signOut(); });

    expect(pushCleanup.disablePushForUser).toHaveBeenCalledWith('u1');
    // `.at(-1)`, not `[0]`. It was written when signOutMock was the one mock in this
    // file never cleared between tests, so its invocationCallOrder carried entries
    // from earlier ones and `[0]` compared two different sign-outs. The missing
    // `mockClear()` is now in the beforeEach, so `[0]` would work — but `.at(-1)` is
    // correct either way and does not depend on that staying true.
    const push = pushCleanup.disablePushForUser.mock.invocationCallOrder.at(-1)!;
    const out = signOutMock.mock.invocationCallOrder.at(-1)!;
    expect(push).toBeLessThan(out);
  });

  it('signs out anyway when unregistering push throws', async () => {
    // Offline, or a denied write. The token stays registered and push keeps
    // arriving — bad, but a user who cannot sign out is worse.
    renderAuth();
    await login({ username: 'malin' });
    pushCleanup.disablePushForUser.mockRejectedValueOnce(new Error('offline'));
    const before = signOutMock.mock.calls.length;

    await act(async () => { await expect(ctx!.signOut()).resolves.toBeUndefined(); });

    // The sign-out itself must still have happened — counted as a delta, since
    // this mock accumulates across the file.
    expect(signOutMock.mock.calls.length).toBe(before + 1);
  });

  it('skips the unregister entirely when this device holds no push token', async () => {
    // Most sign-outs. Without this guard every one of them would lazy-load the
    // firebase/messaging chunk and round-trip to Firestore for nothing.
    renderAuth();
    await login({ username: 'malin' });
    pushCleanup.hasLocalPushToken.mockReturnValue(false);

    await act(async () => { await ctx!.signOut(); });

    expect(pushCleanup.disablePushForUser).not.toHaveBeenCalled();
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('signs out anyway when unregistering push never SETTLES (offline)', async () => {
    // The dimension two review passes missed, and the reason the timeout exists at
    // all: `deleteDoc` against persistentLocalCache resolves on server ack, so
    // offline it neither resolves nor rejects. A bare `await` hangs sign-out forever
    // — no spinner, no error, visitor still signed in on the shared device. A test
    // that only makes the mock REJECT cannot tell the two apart.
    vi.useFakeTimers();
    try {
      renderAuth();
      await login({ username: 'malin' });
      pushCleanup.disablePushForUser.mockImplementationOnce(() => new Promise<void>(() => {}));

      let settled = false;
      const pending = ctx!.signOut().then(() => { settled = true; });

      // Before the timer fires, the sign-out is genuinely still waiting.
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(signOutMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
        await pending;
      });

      expect(settled).toBe(true);
      expect(signOutMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT sweep the invite cache on sign-out', async () => {
    // Malin's 2026-08-10 call against a split panel: the app only ever shows the
    // plaintext to the group's owner, and clearing it would cost the owner their
    // own link — the way back is "Generera ny", which kills the link already
    // shared with people who have not clicked yet.
    renderAuth();
    await login({ username: 'malin' });

    await act(async () => { await ctx!.signOut(); });

    expect(inviteCache.clearAllInviteTokens).not.toHaveBeenCalled();
  });

  it('a sign-out that FAILS still leaves nothing remembered', async () => {
    // A network error leaves them signed in, so the lost path costs nothing —
    // but a half-finished handover must never be the case that keeps it.
    window.sessionStorage.setItem(NEXT_KEY, '/grupper/g-hemlig-123/');
    renderAuth();
    await login({ username: 'malin' });
    signOutMock.mockRejectedValueOnce(new Error('network'));

    await act(async () => {
      await expect(ctx!.signOut()).rejects.toThrow('network');
    });

    expect(stored()).toBeNull();
  });
});

// BIN-748 — BIN-732's rule reads the tab's MEMORY of whether a session existed,
// and a tab starting mid-sign-out has none. Another tab (or a revoked/expired
// token) ends the session while this one re-boots — a reload, a frozen tab
// waking, a tab opened from the signed-in one — with the departing user's URL
// still in the address bar. Its first verdict is `null`, so the guard read it as
// a genuine bounce and stored their page for the next account.
//
// The provider and the guard are rendered TOGETHER here on purpose: the fix is a
// contract between them — the provider records WHICH page this tab is showing a
// session on, the guard asks whether its own page is that one — and each file's
// own harness can only see its half. Mocking the other half would assert the mock.
describe('AuthContext + AuthGuard — a tab that BOOTS mid-sign-out (BIN-748)', () => {
  const NEXT_KEY = 'binge:nextAfterLogin';
  const TAB_KEY = 'binge:tabSession';
  const stored = () => window.sessionStorage.getItem(NEXT_KEY);

  /** Both halves read the URL from their own source — the provider from
   *  usePathname(), the guard from window.location — so move them together. */
  function goto(path: string) {
    window.history.replaceState({}, '', path);
    nav.pathname = path.split('?')[0];
  }

  function renderGuarded() {
    const qc = new QueryClient();
    return render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <AuthGuard><div>hemligt</div></AuthGuard>
        </AuthProvider>
      </QueryClientProvider>,
    );
  }

  // The boot: subscribe, then Firebase's first verdict — "no session".
  async function bootWithNoSession(path: string) {
    goto(path);
    const view = renderGuarded();
    await act(async () => {}); // flusha initAppCheck().then(subscribe)
    expect(authCallback).not.toBeNull();
    await act(async () => { authCallback!(null); });
    return view;
  }

  it('a session arriving marks the page it is being shown on', async () => {
    // The write that makes the whole thing possible: `hadSessionRef` dies with
    // the page, sessionStorage survives a reload of this tab (and only this tab).
    goto('/grupper/g-hemlig-123/');
    renderAuth();
    await login({ username: 'malin' });

    expect(window.sessionStorage.getItem(TAB_KEY)).toBe('/grupper/g-hemlig-123');
  });

  it('the marker follows the session as the user navigates', async () => {
    // Per navigation, not once per session: the page that matters is the one
    // they are ON when the session ends, not the one they signed in on.
    const qc = new QueryClient();
    const tree = () => (
      <QueryClientProvider client={qc}>
        <AuthProvider><Harness /></AuthProvider>
      </QueryClientProvider>
    );
    goto('/grupper/g-hemlig-123/');
    const view = render(tree());
    await login({ username: 'malin' });
    expect(window.sessionStorage.getItem(TAB_KEY)).toBe('/grupper/g-hemlig-123');

    goto('/my/series/');
    await act(async () => { view.rerender(tree()); });

    expect(window.sessionStorage.getItem(TAB_KEY)).toBe('/my/series');
  });

  it('the guard reads the marker the PREVIOUS page load left behind', async () => {
    // THE regression. The previous load of this tab left the marker; the session
    // is already gone by the time this one asks. `/grupper/<id>/` is readable by
    // any signed-in user, so an inherited return path discloses the group's name
    // and memberUids to whoever signs in next on a shared device.
    window.sessionStorage.setItem(TAB_KEY, '/grupper/g-hemlig-123');
    window.sessionStorage.setItem(NEXT_KEY, '/tv/1399/'); // an earlier tap's path
    await bootWithNoSession('/grupper/g-hemlig-123/');

    expect(stored()).toBeNull();
    expect(router.push).toHaveBeenCalledWith('/login');
    expect(screen.queryByText('hemligt')).not.toBeInTheDocument();
  });

  it('an unmarked tab booting signed-out still remembers where it was', async () => {
    // The funnel from the 25k prerendered title pages (BIN-645) is the thing
    // this must not cost. Same boot, no marker.
    await bootWithNoSession('/bibliotek/?status=vill_se');

    expect(stored()).toBe('/bibliotek/?status=vill_se');
  });

  it('the marker silences ONE page, not the rest of the tab', async () => {
    // What replaces retiring the marker at a particular moment — and the reason
    // there is nothing left to get the ordering of. After the handover the
    // visitor is an ordinary signed-out one, and a guarded deep link they tap
    // themselves IS their intent, even though the marker is still sitting there.
    window.sessionStorage.setItem(TAB_KEY, '/grupper/g-hemlig-123');
    const view = await bootWithNoSession('/grupper/g-hemlig-123/');
    expect(stored()).toBeNull();
    view.unmount();

    await bootWithNoSession('/bibliotek/?status=vill_se');

    expect(stored()).toBe('/bibliotek/?status=vill_se');
    expect(window.sessionStorage.getItem(TAB_KEY), 'still standing, and harmless').toBe('/grupper/g-hemlig-123');
  });

  it('a session ending under the mounted page is still a handover (BIN-732)', async () => {
    // The already-covered case must keep working with the marker in play: the
    // in-memory rule and the stored one agree here rather than fighting.
    goto('/grupper/g-hemlig-123/');
    renderGuarded();
    await act(async () => {}); // subscribe
    profileDocData.current = { username: 'malin' };
    authObj.currentUser = fakeUser;
    await act(async () => { authCallback!(fakeUser); });
    expect(window.sessionStorage.getItem(TAB_KEY)).toBe('/grupper/g-hemlig-123');

    await act(async () => {
      authObj.currentUser = null;
      authCallback!(null);
    });

    expect(stored()).toBeNull();
  });
});

// Säkerhetsgranskning 2026-08-05 (BIN-748's panel, filed against this diff) —
// deleteAccount ran the irreversible Firestore erasure FIRST and called
// deleteUser() last, so the single most common real-world click (any session older
// than ~5 minutes) wiped the library, ratings and episode progress, then failed on
// auth/requires-recent-login and told the user to log in again — as if nothing had
// happened. The Auth account, with its email and uid, survived: half an Art. 17
// erasure, in the half that keeps the personal data.
//
// deleteUser() cannot simply be moved first — without a token every write in the
// cascade is denied by firestore.rules — so the gate is a pre-flight token-age
// check, and these tests pin that it runs BEFORE anything is destroyed.
describe('AuthContext — deleteAccount checks session freshness before erasing', () => {
  function minutesAgo(m: number) {
    return new Date(Date.now() - m * 60 * 1000).toUTCString();
  }

  async function signedInProvider() {
    renderAuth();
    await login({ username: 'malin' });
  }

  it('a stale session is turned away with NOTHING erased', async () => {
    // THE regression. Four minutes plus: old enough that Firebase's own ~5-minute
    // rule is about to bite by the time the cascade finishes.
    await signedInProvider();
    authTime.current = minutesAgo(30);

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow(REQUIRES_RECENT_LOGIN);
    });

    // Not one step of the erasure was reached — the user still has an account.
    expect(deletion.collectUserDataSnapshots).not.toHaveBeenCalled();
    expect(deletion.collectDeletionRefs).not.toHaveBeenCalled();
    expect(deletion.applyDeletionPlan).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('the refusal carries BOTH codes the settings UI matches on', async () => {
    // Two claims in one message. `requires-recent-login` is what every existing
    // reader (and Firebase itself) recognises; the pre-flight code is what lets
    // DeleteAccountSection promise "Ingenting har raderats." here and NOT on the
    // same Firebase error thrown after the cascade, where it would be a lie.
    await signedInProvider();
    authTime.current = minutesAgo(10);

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow(REQUIRES_RECENT_LOGIN);
    });
    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow(STALE_SESSION_PREFLIGHT);
    });
  });

  it('the cutoff itself is refused, one millisecond younger is not', async () => {
    // Testgranskningen 2026-08-05: with only 30/10/1-minute fixtures, `<` and
    // `<=` are indistinguishable — a mutant that ACCEPTS a session of exactly
    // the maximum age survived the whole suite. That direction is a separate
    // claim from the NaN-safety below, and only a fixture landing on the exact
    // millisecond can pin it. Hence the frozen clock: `toUTCString()` has
    // second granularity, so an unaligned "now" puts the age up to 999 ms off
    // the boundary and the two operators agree again.
    await signedInProvider();
    const anchor = Date.UTC(2026, 7, 5, 12, 0, 0);
    authTime.current = new Date(anchor - 2 * 60 * 1000).toUTCString();
    const now = vi.spyOn(Date, 'now').mockReturnValue(anchor);

    try {
      await act(async () => {
        await expect(ctx!.deleteAccount()).rejects.toThrow(REQUIRES_RECENT_LOGIN);
      });
      expect(deletion.collectUserDataSnapshots).not.toHaveBeenCalled();

      now.mockReturnValue(anchor - 1); // the session is now 1 ms younger
      await act(async () => { await ctx!.deleteAccount(); });
      expect(deletion.applyDeletionPlan).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it('a fresh session erases Firestore first and the Auth user last', async () => {
    // The happy path, and the reason the order below is not simply reversed:
    // after deleteUser() this client holds no token and firestore.rules denies
    // every write in the cascade.
    await signedInProvider();
    authTime.current = minutesAgo(1);

    await act(async () => { await ctx!.deleteAccount(); });

    expect(deletion.applyDeletionPlan).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    const [gate] = getIdTokenResultMock.mock.invocationCallOrder;
    const [snapshot] = deletion.collectUserDataSnapshots.mock.invocationCallOrder;
    const [erase] = deletion.applyDeletionPlan.mock.invocationCallOrder;
    const [authDelete] = deleteUserMock.mock.invocationCallOrder;
    expect(gate).toBeLessThan(snapshot); // the gate is a PRE-flight check…
    expect(erase).toBeLessThan(authDelete); // …and the cascade still precedes deleteUser
  });

  it('a token read that FAILS stops the deletion instead of proceeding blind', async () => {
    // Offline, or App Check refusing: we cannot tell whether the session is fresh,
    // and the safe answer is to erase nothing. Fail closed.
    await signedInProvider();
    getIdTokenResultMock.mockRejectedValueOnce(new Error('network'));

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow('network');
    });

    expect(deletion.collectUserDataSnapshots).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  // BIN-817: the profile card's localStorage signature is not covered by the
  // Firestore cascade OR by clearFirestorePersistence (IndexedDB only), so before
  // this it survived Art. 17 erasure on the device. It must be removed — but only
  // once the account is actually gone: every guarded abort leaves the account
  // intact, and the device state has to match.
  it('removes the profile-card signature from the device once the account is gone', async () => {
    await signedInProvider();
    authTime.current = minutesAgo(1);

    await act(async () => { await ctx!.deleteAccount(); });

    expect(publicProfile.clearPublicProfileSignature).toHaveBeenCalledWith('u1');
    const [authDelete] = deleteUserMock.mock.invocationCallOrder;
    const [clearSig] = publicProfile.clearPublicProfileSignature.mock.invocationCallOrder;
    expect(authDelete).toBeLessThan(clearSig); // never before the point of no return
  });

  it('leaves the signature alone when the freshness gate refuses', async () => {
    await signedInProvider();
    authTime.current = minutesAgo(30);

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow(REQUIRES_RECENT_LOGIN);
    });

    expect(publicProfile.clearPublicProfileSignature).not.toHaveBeenCalled();
  });

  it('leaves the signature alone when the Auth deletion itself fails', async () => {
    // The account still exists, so the device cache still belongs to a live user.
    await signedInProvider();
    authTime.current = minutesAgo(1);
    deleteUserMock.mockRejectedValueOnce(new Error('network'));

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow('network');
    });

    expect(publicProfile.clearPublicProfileSignature).not.toHaveBeenCalled();
  });

  // BIN-844: the deletion path also sweeps the two device-local leftovers the
  // Firestore cascade cannot reach. Same ordering rule as the profile signature —
  // after the point of no return only.
  it('sweeps the invite cache and the push-token pointer once the account is gone', async () => {
    await signedInProvider();
    authTime.current = minutesAgo(1);

    await act(async () => { await ctx!.deleteAccount(); });

    expect(inviteCache.clearAllInviteTokens).toHaveBeenCalledTimes(1);
    expect(pushCleanup.clearLocalPushTokenId).toHaveBeenCalledWith('u1');
    // `.at(-1)` throughout: these counters are global and monotonic, and not every
    // mock in this file is cleared between tests, so `[0]` can pick up a call from an
    // earlier one and compare two different deletions.
    const authDelete = deleteUserMock.mock.invocationCallOrder.at(-1)!;
    const sweep = inviteCache.clearAllInviteTokens.mock.invocationCallOrder.at(-1)!;
    const pointer = pushCleanup.clearLocalPushTokenId.mock.invocationCallOrder.at(-1)!;
    expect(authDelete).toBeLessThan(sweep);
    // The pointer clear needs its POSITION pinned too, not just its argument. A
    // transient mutant that moved this line above `deleteUser` left the whole suite
    // green — and the consequence is real: a deleteUser that throws leaves a live
    // account whose device has lost the pointer to its own token doc, so the
    // Settings toggle can no longer delete it.
    expect(authDelete).toBeLessThan(pointer);
  });

  it('leaves both alone when the freshness gate refuses', async () => {
    await signedInProvider();
    authTime.current = minutesAgo(30);

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow(REQUIRES_RECENT_LOGIN);
    });

    expect(inviteCache.clearAllInviteTokens).not.toHaveBeenCalled();
    expect(pushCleanup.clearLocalPushTokenId).not.toHaveBeenCalled();
  });

  it('does NOT call disablePushForUser from the deletion path', async () => {
    // The cascade already removed users/{uid}/fcmTokens/*; disablePushForUser
    // would try to delete a doc for an account that no longer exists, with no
    // credentials left to do it. Only the local pointer is dropped here.
    await signedInProvider();
    authTime.current = minutesAgo(1);

    await act(async () => { await ctx!.deleteAccount(); });

    expect(pushCleanup.disablePushForUser).not.toHaveBeenCalled();
  });

  it('an unparsable authTime is treated as stale, not as fresh', async () => {
    // The arithmetic yields NaN, and every `NaN < x` comparison is false. Written
    // the obvious way (`age >= MAX` → refuse) that silently becomes "proceed" and
    // the cascade runs on a session of unknown age.
    await signedInProvider();
    authTime.current = 'inte ett datum';

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow(REQUIRES_RECENT_LOGIN);
    });

    expect(deletion.applyDeletionPlan).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});

// BIN-816 / ADR 0019 conditions 1-5, and Malin's answers of 2026-08-13 (ADR 0020).
//
// The defect: `deleteAccount` erases Firestore and removes the auth user last,
// so anything that kills the second half leaves an account whose data is gone
// and whose identity is not. On the next load `ensureUserProfile` found no
// `users/{uid}`, recreated it, and stamped `termsAcceptedAt`/`ageConfirmedAt`
// with today - a consent record the app manufactured for someone who had just
// asked to leave. Seven other merge writers could do the same with no login at
// all.
//
// Condition 7 sets the test bar and it is deliberately harsher than the ticket's
// own wording: assert the document does not exist AT ALL, not merely that the
// consent fields are unchanged. A guard that wrote everything except two
// timestamps would pass the weaker assertion and still resurrect the profile.
describe('AuthContext — an aborted deletion is not resurrected (BIN-816)', () => {
  function minutesAgo(m: number) {
    return new Date(Date.now() - m * 60 * 1000).toUTCString();
  }

  /** Mark the account as mid-deletion the way deleteAccount does. */
  function markAborted(uid = 'u1') {
    window.localStorage.setItem(`binge:deletionStarted:${uid}`, JSON.stringify({ startedAt: 1 }));
  }

  async function signedInProvider() {
    renderAuth();
    await login({ username: 'malin' });
  }

  it('a marked session writes NO users/{uid} document at all', async () => {
    markAborted();
    renderAuth();
    // profileDocData null = the document is gone, which is exactly what an
    // aborted cascade leaves behind. This is the create branch — the one that
    // resurrects.
    await login(null);

    expect(userDocWrites()).toHaveLength(0);
    // The transaction is where the create happens; not reaching it at all is a
    // stronger statement than "it wrote nothing interesting".
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('a marked session does not re-reserve the username the cascade released', async () => {
    markAborted();
    renderAuth();
    await login(null);

    // tryAutoClaimUsername runs on doc-creation AND as a backfill on an existing
    // doc with no username. Both are behind the same early return.
    expect(claimUsername).not.toHaveBeenCalled();
  });

  it('a marked session does not rebuild the public projection either', async () => {
    // BIN-816 AC2: the cascade deletes publicProfiles/{uid}, and this effect
    // would write it straight back from React state — a second door into the
    // same resurrection, with no login involved.
    markAborted();
    renderAuth();
    await login(null);

    expect(publicProfile.syncMyPublicProfile).not.toHaveBeenCalled();
  });

  it('an UNMARKED session still creates the profile — the guard is not just "off"', async () => {
    // The control. Without it every assertion above passes on a provider that
    // never creates a profile for anyone, which would be a far worse bug.
    renderAuth();
    await login(null);

    expect(runTransaction).toHaveBeenCalled();
    expect(claimUsername).toHaveBeenCalled();
    // And the projection sync DOES run for a healthy session — otherwise the
    // "a marked session does not rebuild the public projection either" test
    // above passes on a provider that never syncs anyone (test review).
    expect(publicProfile.syncMyPublicProfile).toHaveBeenCalled();
  });

  it('the provider reports deletionInProgress so the shell can replace itself', async () => {
    markAborted();
    renderAuth();
    await login(null);

    // This is what AppShell renders the limbo screen on — and the limbo screen
    // is where "blocked from writing" is actually enforced (Malin, 2026-08-13).
    expect(ctx!.deletionInProgress).toBe(true);
    expect(ctx!.user).toBeNull();
  });

  it('the visibility repair does not stamp watchlist docs for a marked session', async () => {
    // NOT belt-and-braces, which is what I had assumed: `runVisibilityCascade`
    // writes `users/{uid}/watchlist/*`, and neither the profile chokepoint (which
    // gates users/{uid} and publicProfiles/{uid} only) nor WatchlistContext's own
    // marker guards (a different provider) cover it. This flag is the only thing
    // between a marked session and a systemic watchlist write — test review,
    // 2026-08-13, who re-derived it on the shipped bytes.
    //
    // Reaching the guard at all takes the interleaving above, and that is not
    // incidental: a marker present BEFORE the load makes `ensureUserProfile`
    // return a null profile, so the effect exits on `!pendingVisibilityTarget`
    // long before this line. A profile AND a raised flag can only co-occur when
    // the marker arrived after the read was already in flight (or when an
    // attempt in this tab failed). My first version of this test missed that and
    // passed against the mutant.
    let releaseProfile!: () => void;
    profileGate.current = new Promise<void>(resolve => { releaseProfile = () => resolve(); });
    profileDocData.current = { username: 'malin', defaultVisibility: 'private', visibilitySyncPending: true };
    authObj.currentUser = fakeUser;
    renderAuth();
    await act(async () => {});
    await act(async () => { authCallback!(fakeUser); });

    markAborted();
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'binge:deletionStarted:u1' }));
    });
    getDocsMock.mockClear();
    batchSets.length = 0;

    await act(async () => { releaseProfile(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(ctx!.deletionInProgress, 'förutsättningen: flaggan är uppe').toBe(true);
    expect(ctx!.user, 'och profilen finns — annars nås inte grenen').not.toBeNull();
    // The repair reads the whole watchlist collection before it writes. Not
    // reaching the read at all is the stronger statement.
    expect(getDocsMock).not.toHaveBeenCalled();
    expect(batchSets).toHaveLength(0);
  });

  it('every profile writer refuses while the deletion is unfinished', async () => {
    // ADR 0019 condition 1. The ticket named two writers; the panel counted
    // eight. Driving them as ONE list is the point: a ninth added later has to
    // be added here too, and the chokepoint guard test fails if it is not routed
    // through the same gate.
    await signedInProvider();
    markAborted();
    setDoc.mockClear();

    const writers: [string, () => Promise<unknown>][] = [
      ['updateBio (updateUserField)', () => ctx!.updateBio('ny bio')],
      ['updateDefaultView (updateUserField)', () => ctx!.updateDefaultView('grid')],
      ['markNotificationsSeen', () => ctx!.markNotificationsSeen()],
      ['updateNotificationSettings', () => ctx!.updateNotificationSettings({ priceDrops: true })],
      ['updateDefaultVisibility', () => ctx!.updateDefaultVisibility('public')],
      ['updateProviderTier', () => ctx!.updateProviderTier(8, null)],
    ];

    for (const [name, run] of writers) {
      await act(async () => {
        await expect(run(), `${name} maste vagra`).rejects.toThrow('binge/deletion-in-progress');
      });
    }

    expect(userDocWrites(), 'ingen av dem fick skriva').toHaveLength(0);
  });

  it('resumeProvider — the batch writer — refuses too, and writes nothing', async () => {
    // It cannot use mergeUserDoc (users/{uid} rides in a larger atomic batch), so
    // it calls the same gate directly. That direct call is the thing most likely
    // to be dropped by a future refactor, hence its own test.
    renderAuth();
    await login({ username: 'malin', providerPauses: { 8: { pausedAt: '2026-01-01', resumeAt: null } } });
    markAborted();
    batchSets.length = 0;
    batchCommit.mockClear();

    await act(async () => {
      await expect(ctx!.resumeProvider(8)).rejects.toThrow('binge/deletion-in-progress');
    });

    // Not merely "it threw": the pauseHistory row must not exist either, or the
    // account grows new data on its way out.
    expect(batchCommit).not.toHaveBeenCalled();
    expect(batchSets).toHaveLength(0);
  });

  it('deleteAccount itself is NEVER gated by the marker (ADR 0019 c3)', async () => {
    // The retry is the only recovery path there is. A marker that blocked it
    // would trap exactly the person it exists to protect — which is why this is
    // a binding condition rather than an implementation detail.
    await signedInProvider();
    markAborted();
    authTime.current = minutesAgo(1);

    await act(async () => { await ctx!.deleteAccount(); });

    expect(deletion.applyDeletionPlan).toHaveBeenCalled();
    expect(deleteUserMock).toHaveBeenCalled();
  });

  it('deleteAccount sets the marker before erasing and clears it once the account is gone', async () => {
    await signedInProvider();
    authTime.current = minutesAgo(1);
    const seenAtCascade: boolean[] = [];
    deletion.collectUserDataSnapshots.mockImplementationOnce(async () => {
      // Condition 2: down BEFORE the first read of the cascade, so a tab that
      // dies mid-run is already marked.
      seenAtCascade.push(window.localStorage.getItem('binge:deletionStarted:u1') !== null);
      return {};
    });

    await act(async () => { await ctx!.deleteAccount(); });

    expect(seenAtCascade).toEqual([true]);
    // And cleared once deleteUser resolved — there is nothing left to resurrect.
    expect(window.localStorage.getItem('binge:deletionStarted:u1')).toBeNull();
  });

  it('a stale session leaves NO marker — the preflight stays a true no-op', async () => {
    // Condition 2's other half. Marking on the button press would lock a user
    // out of a fully intact account for the crime of waiting too long, which is
    // the case STALE_SESSION_PREFLIGHT exists to keep harmless.
    await signedInProvider();
    authTime.current = minutesAgo(30);

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow(STALE_SESSION_PREFLIGHT);
    });

    expect(window.localStorage.getItem('binge:deletionStarted:u1')).toBeNull();
  });

  // BIN-813 — Malins beslut (a), 2026-08-13. Förkontrollen läser markören.
  //
  // Den falska meningen: försök 1 hinner in i kaskaden och faller. Användaren
  // trycker igen utan att logga om. Token är fortfarande för gammal, förkontrollen
  // slår till — och bar tidigare `STALE_SESSION_PREFLIGHT`, koden vars ENDA
  // innebörd är "ingenting är rört" och som ger inställningssidan rätt att skriva
  // "Ingenting har raderats." till någon vars bibliotek redan är borta.
  it('en förkontroll MED markören nere lovar inte längre att ingenting raderats (BIN-813)', async () => {
    await signedInProvider();
    markAborted();
    authTime.current = minutesAgo(30);

    let thrown = '';
    await act(async () => {
      await ctx!.deleteAccount().catch((e: unknown) => { thrown = e instanceof Error ? e.message : ''; });
    });

    expect(thrown).toContain(REQUIRES_RECENT_LOGIN);
    expect(thrown).not.toContain(STALE_SESSION_PREFLIGHT);
    // Det är klassificeringen, inte strängen, som båda skärmarna grenar på —
    // `recent-login` är den låsta texten "Raderingen har påbörjats men inte
    // slutförts…", `preflight` är löftet som inte längre stämmer (villkor 4:
    // ingen femte formulering, bara en annan av de fyra befintliga).
    expect(classifyDeletionFailure(thrown)).toBe('recent-login');
  });

  it('men markören förkortar ALDRIG spärren — den kastar fortfarande, och rör ingenting (BIN-813 villkor 1)', async () => {
    // Panelens bindande villkor 1, som eget påstående: ålderskontrollen körs
    // villkorslöst före varje läsning och skrivning även vid ett nytt försök i
    // samma session. Ett "vi minns ett tidigare försök" som hoppade över porten
    // river BIN-748:s skydd och börjar radera på en token Firebase ändå vägrar.
    await signedInProvider();
    markAborted();
    authTime.current = minutesAgo(30);
    deletion.collectUserDataSnapshots.mockClear();
    deletion.applyDeletionPlan.mockClear();
    deleteUserMock.mockClear();

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow(REQUIRES_RECENT_LOGIN);
    });

    expect(deletion.collectUserDataSnapshots).not.toHaveBeenCalled();
    expect(deletion.applyDeletionPlan).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
    // Och kontrollen är fortfarande ålderskontrollen: en FÄRSK session med samma
    // markör går hela vägen (samma påstående som ADR 0019 villkor 3-testet ovan,
    // här som kontrollprov mot en mutant som låter markören avgöra allt).
    authTime.current = minutesAgo(1);
    await act(async () => { await ctx!.deleteAccount(); });
    expect(deletion.applyDeletionPlan).toHaveBeenCalled();
  });

  it('en UNMARKERAD gammal session får kvar sitt sanna löfte (BIN-813, kontrollprov)', async () => {
    // Utan den här passerar testet ovan mot en implementation som tappade
    // preflight-koden för alla — och då hade BIN-748:s "ingenting har raderats"
    // försvunnit för den som faktiskt inte fått något raderat.
    await signedInProvider();
    authTime.current = minutesAgo(30);

    let thrown = '';
    await act(async () => {
      await ctx!.deleteAccount().catch((e: unknown) => { thrown = e instanceof Error ? e.message : ''; });
    });

    expect(classifyDeletionFailure(thrown)).toBe('preflight');
  });

  it('the marker SURVIVES a cascade that fails — that is the whole point', async () => {
    await signedInProvider();
    authTime.current = minutesAgo(1);
    deletion.applyDeletionPlan.mockRejectedValueOnce(new Error('network'));

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow('network');
    });

    expect(window.localStorage.getItem('binge:deletionStarted:u1')).not.toBeNull();
  });

  it('a SUCCESSFUL deletion never flips the render flag on the way through', async () => {
    // The bug all three reviews found on 2026-08-13. `deletionInProgress` was set
    // next to the marker, before the first read — so `AppShell` swapped the
    // settings page for "vi hann ta bort din data" on the HAPPY path, for every
    // user, for as long as the cascade took (tens of seconds on a heavy account),
    // with a button that started a second concurrent deletion.
    //
    // The marker still goes down first — that part protects the profile. Only the
    // hand-over waits for the attempt to end without success.
    //
    // Driven as hold → observe → release, not as one `await act()`. Inside a
    // single act() React batches the whole run into one commit, so an
    // intermediate `true` never reaches a render and the mutant survives — which
    // it did, twice, before this shape (a state that appears and then goes away
    // cannot be caught by looking only at the end).
    await signedInProvider();
    authTime.current = minutesAgo(1);
    let releaseSnaps!: () => void;
    deletion.collectUserDataSnapshots.mockImplementationOnce(
      () => new Promise(resolve => { releaseSnaps = () => resolve({}); }),
    );
    deletionFlagRenders.length = 0;

    let pending!: Promise<void>;
    // Runs deleteAccount up to its first suspension and lets React commit.
    await act(async () => { pending = ctx!.deleteAccount(); });

    expect(deletionFlagRenders, 'limbo-skärmen får inte renderas medan kaskaden kör')
      .not.toContain(true);
    // The marker IS down by now — the two are deliberately not the same thing.
    expect(window.localStorage.getItem('binge:deletionStarted:u1')).not.toBeNull();

    await act(async () => { releaseSnaps(); await pending; });

    expect(deletionFlagRenders, 'och inte heller efteråt').not.toContain(true);
    expect(ctx!.deletionInProgress).toBe(false);
  });

  it('a FAILED deletion hands the session over to the limbo screen', async () => {
    // The other half: without this, a mid-cascade failure would leave the user on
    // a settings page whose profile writes now all throw, and nothing would tell
    // them why until they reloaded.
    await signedInProvider();
    authTime.current = minutesAgo(1);
    deletion.applyDeletionPlan.mockRejectedValueOnce(new Error('network'));

    deletionFlagRenders.length = 0;

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow('network');
    });

    expect(ctx!.deletionInProgress).toBe(true);
    // And it reached a render — the flag is what AppShell reads, so a value that
    // never renders blocks nothing.
    expect(deletionFlagRenders).toContain(true);
  });

  it('a failure after the marker carries the hand-off tag', async () => {
    // It is what tells DeleteAccountSection that it has been unmounted, so it
    // must not offer a retry button it can no longer honour.
    await signedInProvider();
    authTime.current = minutesAgo(1);
    deletion.applyDeletionPlan.mockRejectedValueOnce(new Error('network'));

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow('binge/deletion-handed-off');
    });
  });

  it('the stale-session preflight does NOT carry the hand-off tag', async () => {
    // It throws before the marker, so the settings page is still mounted and its
    // retry button still works. Tagging it would take that button away for the
    // one case where nothing is wrong with the account at all.
    await signedInProvider();
    authTime.current = minutesAgo(30);

    let thrown = '';
    await act(async () => {
      await ctx!.deleteAccount().catch((e: unknown) => { thrown = e instanceof Error ? e.message : ''; });
    });

    expect(thrown).toContain(STALE_SESSION_PREFLIGHT);
    expect(thrown).not.toContain('binge/deletion-handed-off');
    expect(ctx!.deletionInProgress).toBe(false);
  });

  it('another tab starting a deletion reaches this one through storage', async () => {
    // A tab already rendering the app never re-runs ensureUserProfile, so without
    // this listener it kept the full shell — and WatchlistProvider, which mounts
    // ABOVE AppShell, kept writing owner-scoped documents that outlive both the
    // cascade and the server sweep (security review, 2026-08-13).
    await signedInProvider();
    expect(ctx!.deletionInProgress).toBe(false);

    markAborted();
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'binge:deletionStarted:u1' }));
    });

    expect(ctx!.deletionInProgress).toBe(true);
  });

  it('a storage event DURING the profile load is not overwritten when it resolves', async () => {
    // The race the marker re-read exists for. `ensureUserProfile` samples the
    // marker on its first line; the answer is applied hundreds of ms later. A
    // deletion started in another tab in between set the flag true, and the
    // stale sample then wrote false back over it — permanently, because no
    // further storage event arrives until the marker changes again. That tab
    // kept the whole app and stayed writable during an active deletion
    // (integration + security review, 2026-08-13).
    //
    // The interleaving is the whole test: dispatching inside the same act() as
    // the auth callback fails on CLEAN code, because the listener effect has not
    // committed yet.
    let releaseProfile!: () => void;
    profileGate.current = new Promise<void>(resolve => { releaseProfile = () => resolve(); });
    profileDocData.current = { username: 'malin' };
    authObj.currentUser = fakeUser;
    renderAuth();
    await act(async () => {});
    await act(async () => { authCallback!(fakeUser); });

    // Another tab starts a deletion while our profile read is still in flight.
    markAborted();
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'binge:deletionStarted:u1' }));
    });
    expect(ctx!.deletionInProgress, 'lyssnaren tog').toBe(true);

    // The stale sample lands. It must not undo that.
    await act(async () => { releaseProfile(); await Promise.resolve(); });

    expect(ctx!.deletionInProgress, 'och skrevs inte över').toBe(true);
    // This is the ONLY fixture where a profile and a raised flag co-exist, so it
    // is the only place the projection early-out is reachable. (The write is
    // refused a second time inside mergePublicProfileDoc, which is separately
    // tested — this pins the cheap early-out that also skips the signature read.)
    expect(publicProfile.syncMyPublicProfile).not.toHaveBeenCalled();
  });

  it('a marker for a DIFFERENT account in another tab is ignored', async () => {
    await signedInProvider();

    markAborted('someone_else');
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'binge:deletionStarted:someone_else' }));
    });

    expect(ctx!.deletionInProgress).toBe(false);
  });

  it('a deleteUser network failure is tagged CASCADE_PARTIAL, not left generic (BIN-876)', async () => {
    // Everything before this line succeeded, so the data IS gone and only the
    // identity remains. Untagged, this fell into the settings page's generic
    // branch — the one that says nothing was deleted. That is the biggest
    // possible version of the lie BIN-876 was filed about.
    await signedInProvider();
    authTime.current = minutesAgo(1);
    deleteUserMock.mockRejectedValueOnce(new Error('auth/network-request-failed'));

    await act(async () => {
      await expect(ctx!.deleteAccount()).rejects.toThrow('binge/cascade-partial');
    });
  });

  it('but Firebase own requires-recent-login keeps its own identity', async () => {
    // That error already has a branch saying "started, not finished". Re-tagging
    // it would collapse two messages that deliberately differ, and the settings
    // page checks the recent-login branch BEFORE the partial one.
    await signedInProvider();
    authTime.current = minutesAgo(1);
    deleteUserMock.mockRejectedValueOnce(new Error(`Firebase: Error (${REQUIRES_RECENT_LOGIN}).`));

    let thrown = '';
    await act(async () => {
      await ctx!.deleteAccount().catch((e: unknown) => { thrown = e instanceof Error ? e.message : ''; });
    });

    expect(thrown).toContain(REQUIRES_RECENT_LOGIN);
    expect(thrown).not.toContain('binge/cascade-partial');
  });
});

// BIN-909 — `ensureUserProfile`'s create branch serves two people the code cannot tell
// apart: a first-time Google sign-in (consent given at the login button, BIN-275/348) and
// a RETURNING account whose profile is gone. For the second, stamping fresh
// `termsAcceptedAt`/`ageConfirmedAt` invents a consent record. `metadata.creationTime` is
// the only thing separating them; five minutes is Malin's threshold, 2026-08-27.
describe('AuthContext — reconsent gate for a returning account (BIN-909)', () => {
  // Old enough to be past RETURNING_ACCOUNT_MIN_AGE_MS by a wide margin, so the test does
  // not sit on the boundary — the boundary itself gets its own case below.
  function ageAccount(minutes: number) {
    fakeUser.metadata.creationTime = new Date(Date.now() - minutes * 60 * 1000).toUTCString();
    if (authObj.currentUser) authObj.currentUser.metadata.creationTime = fakeUser.metadata.creationTime;
  }

  function markAborted(uid = 'u1') {
    window.localStorage.setItem(`binge:deletionStarted:${uid}`, JSON.stringify({ startedAt: 1 }));
  }

  it('a returning account with no profile writes NOTHING and is gated', async () => {
    ageAccount(60);
    renderAuth();
    await login(null); // the create branch — the one that used to manufacture the stamp

    expect(ctx!.pendingReconsent).toBe(true);
    expect(ctx!.user).toBeNull();
    // Not reaching the transaction at all is a stronger statement than "wrote nothing
    // interesting" — the create lives inside it.
    expect(runTransaction).not.toHaveBeenCalled();
    expect(userDocWrites()).toHaveLength(0);
  });

  it('a gated account does not re-reserve a username either', async () => {
    // Same second door BIN-816 closed for the deletion case: `tryAutoClaimUsername` runs
    // on creation, so a handle must not be re-reserved for someone who has not consented.
    ageAccount(60);
    renderAuth();
    await login(null);

    expect(claimUsername).not.toHaveBeenCalled();
  });

  it('exactly five minutes old is NOT gated, one millisecond older is', async () => {
    // Without a fixture on the boundary, `>` and `>=` are indistinguishable: every other
    // case here sits an hour past or seconds under. The same mutant survived the whole
    // suite once already for the sibling `RECENT_LOGIN_MAX_AGE_MS` cutoff, which is why
    // that test froze the clock too — `toUTCString()` has second granularity, so an
    // unaligned "now" puts the age up to 999 ms off the boundary and the two operators
    // agree again.
    const anchor = Date.UTC(2026, 7, 27, 12, 0, 0);
    fakeUser.metadata.creationTime = new Date(anchor - 5 * 60 * 1000).toUTCString();
    const now = vi.spyOn(Date, 'now').mockReturnValue(anchor);

    try {
      renderAuth();
      await login(null);
      expect(ctx!.pendingReconsent).toBe(false); // exactly at the threshold: still new
      expect(runTransaction).toHaveBeenCalled();

      cleanup();
      setDoc.mockClear();
      runTransaction.mockClear();
      now.mockReturnValue(anchor + 1); // one millisecond older than the threshold

      renderAuth();
      await login(null);
      expect(ctx!.pendingReconsent).toBe(true);
      expect(runTransaction).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('a BRAND-NEW account is never gated — the control', async () => {
    // Without this every assertion above passes on a provider that gates everyone, which
    // would lock out every new sign-up.
    renderAuth();
    await login(null); // beforeEach leaves creationTime at "now"

    expect(ctx!.pendingReconsent).toBe(false);
    expect(runTransaction).toHaveBeenCalled();
    expect(ctx!.user?.displayName).toBe('Malin');
  });

  it('an EXISTING profile on an old account is never gated', async () => {
    // The gate sits after the read on purpose: everyone who has used the app for more
    // than five minutes is "old", and gating them would be the whole user base.
    ageAccount(60 * 24 * 30);
    renderAuth();
    await login({ username: 'malin' });

    expect(ctx!.pendingReconsent).toBe(false);
    expect(ctx!.user?.username).toBe('malin');
  });

  it('an absent creationTime reads as NEW, not as returning', async () => {
    // The error direction is deliberate: a bug in Firebase's metadata should cost a
    // manufactured stamp in a rare case, never lock every new user out of signing up.
    fakeUser.metadata.creationTime = undefined;
    renderAuth();
    await login(null);

    expect(ctx!.pendingReconsent).toBe(false);
    expect(runTransaction).toHaveBeenCalled();
  });

  it('deletionInProgress wins when a marked session is ALSO old', async () => {
    // Both states are reachable at once, and they want opposite screens. The deletion
    // return sits before the age check, so the limbo screen keeps precedence — an aborted
    // deletion must never be offered a "create your profile" button.
    markAborted();
    ageAccount(60);
    renderAuth();
    await login(null);

    expect(ctx!.deletionInProgress).toBe(true);
    expect(ctx!.pendingReconsent).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('signing out clears the gate for the next account on a shared device', async () => {
    // The marker-based sibling flag is cleared here for the same reason. Leaving this
    // one set would greet a genuinely NEW account with "Välkommen tillbaka" until its
    // own profile load resolved — on a device two people share.
    ageAccount(60);
    renderAuth();
    await login(null);
    expect(ctx!.pendingReconsent).toBe(true);

    authObj.currentUser = null;
    await act(async () => { authCallback!(null); });

    expect(ctx!.pendingReconsent).toBe(false);
  });

  it('completeReconsent creates the profile with FRESH server-stamped consent', async () => {
    ageAccount(60);
    renderAuth();
    await login(null);
    expect(userDocWrites()).toHaveLength(0); // still nothing written

    await act(async () => { await ctx!.completeReconsent(); });

    const writes = userDocWrites();
    expect(writes).toHaveLength(1); // exactly one create, not one per checkbox
    const [, payload] = writes[0] as [unknown, Record<string, unknown>];
    // 'ts' is what the harness's serverTimestamp() returns. Both stamps must be it —
    // a value derived from metadata.creationTime would backdate the consent to a moment
    // the user did not consent at, which is the record this ticket removes.
    expect(payload.termsAcceptedAt).toBe('ts');
    expect(payload.ageConfirmedAt).toBe('ts');
    expect(payload.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(ctx!.pendingReconsent).toBe(false);
    expect(ctx!.user?.displayName).toBe('Malin');
  });

  it('the gate stays up until completeReconsent is called — abandoning it leaves no document', async () => {
    // The screen is a shell takeover, so "abandoning" means signing out or closing the
    // tab. Nothing may be written on the way in OR on the way past.
    ageAccount(60);
    renderAuth();
    await login(null);

    await act(async () => {}); // let every provider effect settle

    expect(userDocWrites()).toHaveLength(0);
    expect(claimUsername).not.toHaveBeenCalled();
    expect(reconsentFlagRenders.at(-1)).toBe(true);
  });

  it('completeReconsent refuses once a deletion has started, and writes nothing (BIN-1032)', async () => {
    // The gap the ticket names: `completeReconsent` never goes through
    // `ensureUserProfile`, so the marker read that guards every other create path did
    // not cover this one. The whole click-to-write window was ungated.
    //
    // The marker goes down AFTER the gate is already on screen — that is the only order
    // that reaches the branch. A marker present at load makes `deletionInProgress` true,
    // and `AppShell` gives the limbo screen precedence, so the gate never renders.
    //
    // `markAborted()` writes the marker this browser reads, which is what the guard reads
    // too — the same device, mid-render. An earlier version of this comment called it the
    // cross-device case; the marker is localStorage, so a second DEVICE never has one and
    // the guard could not fire for it. Struck rather than replaced with a new scenario.
    ageAccount(60);
    renderAuth();
    await login(null);
    expect(reconsentFlagRenders.at(-1), 'förutsättningen: grinden är uppe').toBe(true);
    expect(userDocWrites()).toHaveLength(0);

    markAborted();

    await act(async () => {
      await expect(ctx!.completeReconsent()).rejects.toThrow('binge/deletion-in-progress');
    });

    // Not merely "it threw": the create must not have happened. `runTransaction` is the
    // stronger assertion of the two — refusing before it means the guard sits ahead of
    // the first await, not after a round trip that already opened the window.
    expect(runTransaction, 'transaktionen fick aldrig startas').not.toHaveBeenCalled();
    expect(userDocWrites(), 'och ingenting skrevs').toHaveLength(0);
    expect(claimUsername).not.toHaveBeenCalled();
  });

  it('completeReconsent adopts nothing if a different account signed in meanwhile', async () => {
    // Same account-switch guard the profile-load path uses. Without it a slow create
    // lands its profile into a session that now belongs to someone else.
    ageAccount(60);
    renderAuth();
    await login(null);

    // The switch has to happen DURING the create, not before it: the guard compares the
    // user captured on the way in against `auth.currentUser` on the way out. Swapping
    // first would just compare the new user to himself and prove nothing.
    runTransaction.mockImplementationOnce(async (_db: unknown, updateFn: Parameters<typeof runTransaction>[1]) => {
      authObj.currentUser = { ...fakeUser, uid: 'someone-else' };
      return updateFn({
        get: async () => ({ exists: () => false, data: () => ({}) }),
        set: (ref: unknown, data: Record<string, unknown>) => { setDoc(ref, data); },
      });
    });
    await act(async () => { await ctx!.completeReconsent(); });

    expect(ctx!.user).toBeNull();
    expect(ctx!.pendingReconsent).toBe(true); // still gated, nothing adopted
  });
});
