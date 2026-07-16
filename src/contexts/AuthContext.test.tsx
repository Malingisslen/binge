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

vi.mock('@/lib/firebase/db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
    getDoc: async () => ({
      exists: () => profileDocData.current !== null,
      data: () => profileDocData.current ?? {},
    }),
    setDoc,
    serverTimestamp: () => 'ts',
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
