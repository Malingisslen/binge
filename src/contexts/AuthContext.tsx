'use client';

import { createContext, useContext, useMemo, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  signOut as firebaseSignOut,
  deleteUser,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { fsdb, getDb, clearFirestorePersistence } from '@/lib/firebase/db';
import { initAppCheck } from '@/lib/firebase/appCheck';
import { collectUserDataSnapshots } from '@/lib/firebase/userData';
import { collectDeletionRefs, applyDeletionPlan } from '@/lib/firebase/accountDeletion';
import { CURRENT_TERMS_VERSION } from '@/lib/legal';
import { getProvider, resolveProviderMonthlyCost } from '@/lib/tmdb/providers';
import { daysBetween, todayIso } from '@/lib/utils';
import type { ItemVisibility, UserProfile } from '@/types';

interface AuthState {
  user: UserProfile | null;
  uid: string | null;
  loading: boolean;
  /**
   * True medan Firestore-profilen laddas EFTER att auth-beskedet kommit.
   * `loading` (auth-besked) släpps direkt så watchlist/TMDB kan starta;
   * ytor som kräver profildata (isAdmin-gates, onboarding-beslut) ska vänta
   * på loading || profileLoading.
   */
  profileLoading: boolean;
  // Firebase Auth email-verification-state. Gör inte gating idag men UI:t
  // kan visa en banner när emailVerified=false (och resend därifrån).
  emailVerified: boolean;
  signIn: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, termsVersion: string) => Promise<void>;
  resendEmailVerification: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProviders: (providers: number[]) => Promise<void>;
  updateDefaultView: (view: 'table' | 'grid' | 'cards') => Promise<void>;
  updateProviderCosts: (costs: Record<number, number>) => Promise<void>;
  updateHomeMunicipality: (kommun: string | null) => Promise<void>;
  updateRotationSchedule: (schedule: NonNullable<UserProfile['rotationSchedule']>) => Promise<void>;
  // Sätt/ta bort EN providers kostnad (null = ta bort). Slår ihop mot senaste
  // state så samtidiga blur-skrivningar inte klobbrar varandra (BIN-40).
  setProviderCost: (providerId: number, cost: number | null) => Promise<void>;
  // Sätt/ta bort EN providers faktureringsdag (null = ta bort). Samma
  // funktionella-merge-härdning som setProviderCost (BIN-46, jfr BIN-40).
  setProviderRenewalDay: (providerId: number, day: number | null) => Promise<void>;
  updateProviderTier: (providerId: number, tierId: string | null) => Promise<void>;
  pauseProvider: (providerId: number, resumeAt?: string | null) => Promise<void>;
  resumeProvider: (providerId: number) => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
  updateBio: (bio: string) => Promise<void>;
  updateDefaultVisibility: (visibility: ItemVisibility) => Promise<void>;
  markNotificationsSeen: () => Promise<void>;
  updateNotificationSettings: (patch: Partial<UserProfile['notificationSettings']>) => Promise<void>;
  /** @deprecated — använd updateDefaultVisibility. Kvar för UI som inte migrerats. */
  updateIsPublic: (isPublic: boolean) => Promise<void>;
  updateHideNonLatinTitles: (hide: boolean) => Promise<void>;
  updateHiddenCountries: (countries: string[]) => Promise<void>;
  setCalibrationGenres: (genres: Record<number, number> | null) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  uid: null,
  loading: true,
  profileLoading: false,
  emailVerified: false,
  signIn: async () => {},
  signInEmail: async () => {},
  register: async () => {},
  resendEmailVerification: async () => {},
  signOut: async () => {},
  updateProviders: async () => {},
  updateDefaultView: async () => {},
  updateProviderCosts: async () => {},
  updateHomeMunicipality: async () => {},
  updateRotationSchedule: async () => {},
  setProviderCost: async () => {},
  setProviderRenewalDay: async () => {},
  updateProviderTier: async () => {},
  pauseProvider: async () => {},
  resumeProvider: async () => {},
  updateUsername: async () => {},
  updateBio: async () => {},
  updateDefaultVisibility: async () => {},
  markNotificationsSeen: async () => {},
  updateNotificationSettings: async () => {},
  updateIsPublic: async () => {},
  updateHideNonLatinTitles: async () => {},
  updateHiddenCountries: async () => {},
  setCalibrationGenres: async () => {},
  deleteAccount: async () => {},
});

// Försöker claima ett auto-genererat username från Google displayName /
// email-localpart. Returnerar det claimade värdet vid lyckat utfall, annars
// null. Misslyckas tyst — användaren kan alltid välja själv i Settings.
async function tryAutoClaimUsername(firebaseUser: User): Promise<string | null> {
  try {
    const { suggestUsernameFromIdentity, findAvailableUsername, claimUsername } =
      await import('@/lib/firebase/username');
    const base = suggestUsernameFromIdentity(firebaseUser.displayName, firebaseUser.email);
    if (!base) return null;
    const available = await findAvailableUsername(base);
    if (!available) return null;
    await claimUsername(firebaseUser.uid, available, null);
    return available;
  } catch (err) {
    console.warn('[username-auto-suggest]', err);
    return null;
  }
}

async function ensureUserProfile(firebaseUser: User): Promise<UserProfile> {
  const { db, doc, getDoc, setDoc, serverTimestamp } = await fsdb();
  const ref = doc(db, 'users', firebaseUser.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data();
    const isPublicLegacy = (data.isPublic as boolean) ?? false;
    const existing: UserProfile = {
      displayName: data.displayName ?? firebaseUser.displayName ?? '',
      email: data.email ?? firebaseUser.email ?? '',
      photoURL: data.photoURL ?? firebaseUser.photoURL,
      username: (data.username as string) ?? null,
      bio: (data.bio as string) ?? '',
      // Lazy migration: legacy isPublic-boolean → tre-state defaultVisibility.
      // Skrivs aldrig tillbaka här — bara nästa gång användaren ändrar något.
      defaultVisibility: (data.defaultVisibility as ItemVisibility) ?? (isPublicLegacy ? 'public' : 'private'),
      isPublic: isPublicLegacy,
      myProviders: data.myProviders ?? [],
      defaultView: data.defaultView ?? 'table',
      hideNonLatinTitles: (data.hideNonLatinTitles as boolean) ?? false,
      hiddenCountries: (data.hiddenCountries as string[]) ?? [],
      providerCosts: (data.providerCosts as Record<number, number>) ?? {},
      providerTiers: (data.providerTiers as Record<number, string>) ?? {},
      providerRenewalDays: (data.providerRenewalDays as Record<number, number>) ?? {},
      providerPauses: (data.providerPauses as UserProfile['providerPauses']) ?? {},
      calibrationGenres: (data.calibrationGenres as Record<number, number> | null) ?? null,
      hemkommun: (data.hemkommun as string | null) ?? null,
      createdAt: data.createdAt?.toDate() ?? new Date(),
      updatedAt: data.updatedAt?.toDate() ?? new Date(),
      termsAcceptedAt: data.termsAcceptedAt?.toDate(),
      termsVersion: data.termsVersion as string | undefined,
      ageConfirmedAt: data.ageConfirmedAt?.toDate(),
      onboardingCompletedAt: data.onboardingCompletedAt?.toDate(),
      lastNotificationsSeenAt: data.lastNotificationsSeenAt?.toDate(),
      isAdmin: (data.isAdmin as boolean) ?? false,
      notificationSettings: {
        newEpisodes: data.notificationSettings?.newEpisodes ?? true,
        availableOnMyServices: data.notificationSettings?.availableOnMyServices ?? true,
        pushEnabled: data.notificationSettings?.pushEnabled ?? false,
        episodeReleases: data.notificationSettings?.episodeReleases ?? true,
        priceDrops: data.notificationSettings?.priceDrops ?? false,
        rotationReminders: data.notificationSettings?.rotationReminders ?? false,
        weeklyDigest: data.notificationSettings?.weeklyDigest ?? false,
      },
      rotationSchedule: (data.rotationSchedule as UserProfile['rotationSchedule']) ?? undefined,
    };

    // Backfill för existing Google-konton som loggade in före auto-suggest:en
    // landade. Försöket är idempotent — vid lyckad claim sätts username och
    // nästa sign-in skippar grenen helt. Misslyckas tyst.
    if (existing.username === null) {
      const claimed = await tryAutoClaimUsername(firebaseUser);
      if (claimed) existing.username = claimed;
    }

    return existing;
  }

  const profile: UserProfile = {
    displayName: firebaseUser.displayName ?? '',
    email: firebaseUser.email ?? '',
    photoURL: firebaseUser.photoURL,
    username: null,
    bio: '',
    defaultVisibility: 'private',
    isPublic: false,
    myProviders: [],
    defaultView: 'table',
    hideNonLatinTitles: false,
    hiddenCountries: [],
    providerCosts: {},
    providerTiers: {},
    providerRenewalDays: {},
    providerPauses: {},
    calibrationGenres: null,
    hemkommun: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    // BIN-275/348: first sign-in via Google is browse-wrap consent — the login
    // page shows a terms + 13+-age notice at the Google button, so creating the
    // doc records acceptance + age confirmation, mirroring the register() path.
    termsAcceptedAt: new Date(),
    termsVersion: CURRENT_TERMS_VERSION,
    ageConfirmedAt: new Date(),
    notificationSettings: {
      newEpisodes: true,
      availableOnMyServices: true,
      pushEnabled: false,
      episodeReleases: true,
      priceDrops: false,
      rotationReminders: false,
      weeklyDigest: false,
    },
  };

  await setDoc(ref, {
    ...profile,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    termsAcceptedAt: serverTimestamp(),
    ageConfirmedAt: serverTimestamp(),
  });

  // Auto-föreslå username från Google displayName / email-localpart. Triggar
  // bara på doc-creation (existing-grenen kör samma helper inline).
  const claimed = await tryAutoClaimUsername(firebaseUser);
  if (claimed) profile.username = claimed;

  return profile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    // App Check måste vara initierad innan onAuthStateChanged subscribar —
    // Auth attachar App Check-tokens till alla Identity Toolkit-calls (inkl.
    // token-refresh på boot) och hänger annars på en token-provider som
    // aldrig kommer. initAppCheck() är async (lazy-laddad chunk) men resolvar
    // direkt utan site key, så detta kostar inget i default-läget.
    // Warm-up: Firestore-SDK:n är lazy (se lib/firebase/db.ts). Återvändande
    // inloggade användare (wasLoggedIn-flaggan) får chunken hämtad direkt
    // efter first paint istället för att vänta på att onAuthStateChanged
    // resolvar — sparar ett nätverks-vattenfall innan första snapshoten.
    try {
      if (window.localStorage.getItem('binge:wasLoggedIn')) void getDb();
    } catch { /* private mode */ }
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    // initAppCheck rejectar aldrig (fel sväljs internt) — subscriben nås
    // alltid, annars fastnar appen i loading=true.
    void initAppCheck().then(() => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        if (firebaseUser) {
          // Släpp appen direkt på auth-beskedet — watchlist-snapshoten och
          // sid-queries startar parallellt med profil-hämtningen istället
          // för att serialiseras bakom den (en hel Firestore-RTT).
          setUid(firebaseUser.uid);
          setEmailVerified(firebaseUser.emailVerified);
          setLoading(false);
          setProfileLoading(true);
          // SSR-flagga för startsidan: prerendrad HTML är alltid LandingPage
          // (för Googlebot + LLM-crawlers). Inloggade återvändande användare
          // hoppar direkt till dashboard-skeletten istället för att se en
          // LandingPage-flicker — page.tsx läser den här flaggan synkront
          // i en lazy useState-init innan hydration.
          try { window.localStorage.setItem('binge:wasLoggedIn', '1'); } catch { /* private mode */ }

          void ensureUserProfile(firebaseUser)
            .then((profile) => {
              // Account-switch-skydd: skriv bara om samma användare
              // fortfarande är inloggad när profilen landar.
              if (auth.currentUser?.uid === firebaseUser.uid) setUser(profile);
            })
            .catch((err) => {
              console.error('Failed to load user profile:', err);
              // uid behålls — auth är giltig även om profil-läsningen
              // failade; user-beroende ytor null-hanterar redan.
              if (auth.currentUser?.uid === firebaseUser.uid) setUser(null);
            })
            .finally(() => {
              if (auth.currentUser?.uid === firebaseUser.uid) setProfileLoading(false);
            });
        } else {
          setUser(null);
          setUid(null);
          setEmailVerified(false);
          setProfileLoading(false);
          try { window.localStorage.removeItem('binge:wasLoggedIn'); } catch { /* private mode */ }
          setLoading(false);
        }
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // BIN-23: Firebase fire:ar inte onAuthStateChanged vid silent token-refresh,
  // så emailVerified fastnar på false tills man loggar ut/in. Vanligaste flödet
  // är att man klickar verifierings-länken i en ANNAN flik och återvänder hit —
  // då reload:ar vi user:n på window-focus och uppdaterar flaggan så
  // verifierings-bannern auto-döljs (täcker även "skicka igen → verifiera →
  // tillbaka"). Hoppar reload:en när redan verifierad → ingen kostnad på
  // hot-pathen, ingen Firestore-läsning.
  useEffect(() => {
    const onFocus = () => {
      const u = auth.currentUser;
      if (!u || u.emailVerified) return;
      void u.reload()
        .then(() => setEmailVerified(auth.currentUser?.emailVerified ?? false))
        .catch(() => { /* offline/transient — bannern står kvar, ny chans vid nästa focus */ });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const signIn = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }, []);

  const signInEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string, termsVersion: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    // Create the user doc ourselves (instead of relying on onAuthStateChanged
    // + ensureUserProfile) so we can atomically include terms-acceptance
    // metadata. onAuthStateChanged will subsequently load the complete doc.
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    await setDoc(doc(db, 'users', cred.user.uid), {
      displayName: name,
      email: cred.user.email ?? email,
      photoURL: cred.user.photoURL,
      username: null,
      bio: '',
      defaultVisibility: 'private',
      isPublic: false,
      myProviders: [],
      defaultView: 'table',
      hideNonLatinTitles: false,
      hiddenCountries: [],
      providerCosts: {},
      providerTiers: {},
      providerRenewalDays: {},
      providerPauses: {},
      calibrationGenres: null,
      hemkommun: null,
      notificationSettings: { newEpisodes: true, availableOnMyServices: true, pushEnabled: false, episodeReleases: true, priceDrops: false, rotationReminders: false, weeklyDigest: false },
      termsAcceptedAt: serverTimestamp(),
      termsVersion,
      ageConfirmedAt: serverTimestamp(), // BIN-348: the register form gates on the 13+ checkbox; record it.
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    // Skicka verifieringsmail. Felar vi här blockerar vi inte registreringen
    // — användaren kan resend:a från settings. Loggas bara så vi kan
    // upptäcka om maildelivery går ner brett.
    try {
      await sendEmailVerification(cred.user);
    } catch (err) {

      console.warn('[email-verification]', err);
    }
  }, []);

  const resendEmailVerification = useCallback(async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    // Clear React Query cache so the next user (on shared device) or a
    // re-signed-in user starts with empty server-state instead of the
    // previous user's cached watchlist / reviews / notifications.
    queryClient.clear();
    // GDPR-hygien på delad enhet: Firestores IndexedDB-cache
    // (persistentLocalCache) överlever annars signOut, så nästa användare
    // skulle kort kunna se föregående användares watchlist från disk.
    // Fel sväljs i helpern — en misslyckad rensning blockerar aldrig
    // utloggningen.
    await clearFirestorePersistence();
  }, [queryClient]);

  const updateUserField = useCallback(async <K extends keyof UserProfile>(field: K, value: UserProfile[K]) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    await setDoc(doc(db, 'users', uid), { [field]: value, updatedAt: serverTimestamp() }, { merge: true });
    setUser(prev => prev ? { ...prev, [field]: value } : null);
  }, [uid]);

  const updateProviders = useCallback(async (providers: number[]) => {
    await updateUserField('myProviders', providers);
    if (!uid) return;
    // Provider-drift (Fas 2): propagera ändringen till gruppmedlemskap så
    // gruppens intersect/union hålls aktuell utan att medlemmen behöver
    // gå in i varje grupp och uppdatera.
    const { updateMemberProviders } = await import('@/lib/firebase/groups');
    const { db, collection: col, getDocs: get, query: q, where } = await fsdb();
    const snap = await get(q(col(db, 'groups'), where('memberUids', 'array-contains', uid)));
    await Promise.all(
      snap.docs.map(d => updateMemberProviders(d.id, uid, providers).catch(() => {})),
    );
  }, [updateUserField, uid]);
  const updateDefaultView = useCallback((view: 'table' | 'grid' | 'cards') => updateUserField('defaultView', view), [updateUserField]);
  const updateProviderCosts = useCallback((costs: Record<number, number>) => updateUserField('providerCosts', costs), [updateUserField]);
  // BIN-172: hemkommun = "jag har ett lånekort i {kommun}". null rensar fältet.
  const updateHomeMunicipality = useCallback((kommun: string | null) => updateUserField('hemkommun', kommun), [updateUserField]);
  // BIN-181: persist the rotation-calendar snapshot the reminder function reads.
  const updateRotationSchedule = useCallback((schedule: NonNullable<UserProfile['rotationSchedule']>) => updateUserField('rotationSchedule', schedule), [updateUserField]);
  // Spegel av user.providerCosts som uppdateras SYNKRONT i setProviderCost (före
  // await) så att tabbning från provider A:s kostnad till B:s inte skriver två
  // blur:ar mot samma stale render-snapshot och tappar A:s värde (BIN-40).
  const providerCostsRef = useRef<Record<number, number>>({});
  useEffect(() => { providerCostsRef.current = user?.providerCosts ?? {}; }, [user?.providerCosts]);
  const setProviderCost = useCallback(async (providerId: number, cost: number | null) => {
    const next = { ...providerCostsRef.current };
    if (cost == null) delete next[providerId];
    else next[providerId] = cost;
    providerCostsRef.current = next;
    await updateUserField('providerCosts', next);
  }, [updateUserField]);
  // Samma synkrona-spegel-mönster som providerCosts (BIN-46) så tabbning mellan
  // fält inte skriver mot en stale render-snapshot och tappar ett värde.
  const providerRenewalDaysRef = useRef<Record<number, number>>({});
  useEffect(() => { providerRenewalDaysRef.current = user?.providerRenewalDays ?? {}; }, [user?.providerRenewalDays]);
  const setProviderRenewalDay = useCallback(async (providerId: number, day: number | null) => {
    const next = { ...providerRenewalDaysRef.current };
    if (day == null) delete next[providerId];
    else next[providerId] = day;
    providerRenewalDaysRef.current = next;
    await updateUserField('providerRenewalDays', next);
  }, [updateUserField]);
  const updateProviderTier = useCallback(async (providerId: number, tierId: string | null) => {
    if (!uid || !user) return;
    const { getProvider } = await import('@/lib/tmdb/providers');
    const provider = getProvider(providerId);
    const tier = tierId ? provider?.tiers?.find(t => t.id === tierId) : null;

    const nextTiers = { ...(user.providerTiers ?? {}) };
    const nextCosts = { ...(user.providerCosts ?? {}) };

    if (tierId && tier) {
      nextTiers[providerId] = tierId;
      // Live tier pricing: the cost derives from the chosen tier at read time
      // (resolveProviderMonthlyCost), so we no longer freeze tier.cost into
      // providerCosts. Deleting any stale frozen snapshot here IS the lazy
      // migration — providerCosts now means "egen inskriven kostnad" only, so a
      // tier user + a providerCosts entry is a leftover we clean on next touch.
      delete nextCosts[providerId];
    } else {
      delete nextTiers[providerId];
    }

    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    await setDoc(doc(db, 'users', uid), {
      providerTiers: nextTiers,
      providerCosts: nextCosts,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setUser(prev => prev ? { ...prev, providerTiers: nextTiers, providerCosts: nextCosts } : null);
  }, [uid, user]);
  const pauseProvider = useCallback((providerId: number, resumeAt: string | null = null) => {
    const current = user?.providerPauses ?? {};
    const existing = current[providerId];
    if (existing && existing.resumeAt === resumeAt) return Promise.resolve();
    const pausedAt = existing?.pausedAt ?? todayIso();
    const next = { ...current, [providerId]: { pausedAt, resumeAt } };
    return updateUserField('providerPauses', next);
  }, [updateUserField, user?.providerPauses]);
  const resumeProvider = useCallback(async (providerId: number) => {
    if (!uid) return;
    const current = user?.providerPauses ?? {};
    const pause = current[providerId];
    if (!pause) return;

    // Snapshot the RESOLVED cost at resume — deliberate timing (the pause is over,
    // so this is the price that actually applied). We freeze the resolved price
    // (live tier price if a tier is chosen, else the user's custom cost, else
    // default) rather than raw providerCosts, so a tier user whose frozen snapshot
    // was migrated away still records the right saved amount instead of falling to
    // defaultMonthlyCost. Historic pauseHistory rows are never rewritten.
    const provider = getProvider(providerId);
    const monthlyCost = resolveProviderMonthlyCost(providerId, {
      providerTiers: user?.providerTiers,
      providerCosts: user?.providerCosts,
    }) ?? 0;
    // Minst 1 dag — annars hamnar pause-then-instant-resume-test som 0 kr.
    const durationDays = Math.max(1, daysBetween(pause.pausedAt));
    const savedAmount = Math.round((monthlyCost * durationDays) / 30);

    const next = { ...current };
    delete next[providerId];

    // Atomisk batch: skriv historik-doc + uppdaterade providerPauses i ett
    // svep. Om något steg failar rullas båda tillbaka, så vi får inga
    // orfaner — antingen är pausen kvar OCH historiken oskriven, eller så
    // är pausen borta OCH historiken sparad.
    const { db, doc, collection, writeBatch, serverTimestamp } = await fsdb();
    const batch = writeBatch(db);
    const historyRef = doc(collection(db, 'users', uid, 'pauseHistory'));
    batch.set(historyRef, {
      providerId,
      providerShortName: provider?.shortName ?? `Provider ${providerId}`,
      pausedAt: pause.pausedAt,
      resumedAt: todayIso(),
      monthlyCost,
      durationDays,
      savedAmount,
      createdAt: serverTimestamp(),
    });
    batch.set(
      doc(db, 'users', uid),
      { providerPauses: next, updatedAt: serverTimestamp() },
      { merge: true },
    );
    await batch.commit();
    setUser(prev => prev ? { ...prev, providerPauses: next } : null);
  }, [uid, user]);
  const updateBio = useCallback((bio: string) => updateUserField('bio', bio), [updateUserField]);

  const updateDefaultVisibility = useCallback(async (visibility: ItemVisibility) => {
    if (!uid) return;
    // Stega 1: uppdatera profil-fältet (+ legacy isPublic-mirror för bakåt-
    // kompatibilitet i rules under migrationsperioden).
    const isPublicMirror = visibility === 'public';
    const { db, doc, setDoc, getDocs, collection, writeBatch, serverTimestamp } = await fsdb();
    await setDoc(doc(db, 'users', uid), {
      defaultVisibility: visibility,
      isPublic: isPublicMirror,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setUser(prev => prev ? { ...prev, defaultVisibility: visibility, isPublic: isPublicMirror } : null);

    // Stega 2: cascade till alla watchlist-items utan explicit per-item-
    // override. Firestore-regler kan inte joina mot parent-user-doc per item,
    // så vi denormaliserar 'effectiveVisibility' (+ legacy isPublic-mirror) på
    // varje item-doc. Items som har egen 'visibility'-override lämnas orörda.
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'watchlist'));
      const updatable = snap.docs.filter(d => d.data().visibility == null);
      const chunks: typeof updatable[] = [];
      for (let i = 0; i < updatable.length; i += 450) {
        chunks.push(updatable.slice(i, i + 450));
      }
      await Promise.all(chunks.map(chunk => {
        const batch = writeBatch(db);
        for (const d of chunk) {
          batch.set(d.ref, {
            effectiveVisibility: visibility,
            isPublic: isPublicMirror,
          }, { merge: true });
        }
        return batch.commit();
      }));
    } catch (err) {
      console.error('[defaultVisibility cascade]', err);
    }
  }, [uid]);

  // Deprecated forwarder — UI som inte migrerats till tre-state radio.
  const updateIsPublic = useCallback(async (isPublic: boolean) => {
    await updateDefaultVisibility(isPublic ? 'public' : 'private');
  }, [updateDefaultVisibility]);

  // Sätter lastNotificationsSeenAt = serverTimestamp, vilket kollapsar
  // "nya filmkvällar"-räkningen i bell-badge:n. Friend requests har sin
  // egen action-required-räkning och påverkas inte.
  const markNotificationsSeen = useCallback(async () => {
    if (!uid) return;
    const now = new Date();
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    await setDoc(doc(db, 'users', uid), {
      lastNotificationsSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setUser(prev => prev ? { ...prev, lastNotificationsSeenAt: now } : null);
  }, [uid]);

  // Patch-update av notification-settings. Tar Partial för att UI:n bara ska
  // skicka det fält som ändrats — Firestore mergar resten. Cloud Functions
  // läser detta fält som hårt på/av-villkor innan FCM-skick.
  const updateNotificationSettings = useCallback(async (
    patch: Partial<UserProfile['notificationSettings']>,
  ) => {
    if (!uid || !user) return;
    const merged = { ...user.notificationSettings, ...patch };
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    await setDoc(doc(db, 'users', uid), {
      notificationSettings: merged,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setUser(prev => prev ? { ...prev, notificationSettings: merged } : null);
  }, [uid, user]);
  const updateHideNonLatinTitles = useCallback((hide: boolean) => updateUserField('hideNonLatinTitles', hide), [updateUserField]);
  const updateHiddenCountries = useCallback((countries: string[]) => updateUserField('hiddenCountries', countries), [updateUserField]);
  const setCalibrationGenres = useCallback((genres: Record<number, number> | null) => updateUserField('calibrationGenres', genres), [updateUserField]);

  const updateUsername = useCallback(async (username: string) => {
    if (!uid || !user) return;
    const { claimUsername } = await import('@/lib/firebase/username');
    await claimUsername(uid, username, user.username);
    setUser(prev => prev ? { ...prev, username } : null);
  }, [uid, user]);

  const deleteAccount = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const id = currentUser.uid;

    // Delad läsning med buildUserExport — om nya user-owned collections
    // läggs till ska de uppdateras i collectUserDataSnapshots.
    const snaps = await collectUserDataSnapshots(id);
    const kit = await fsdb();

    // Cascade-plan + commit are extracted (BIN-347) into pure, db-injectable
    // helpers so the Art. 17 erasure path can be run end-to-end against the
    // Firestore emulator (src/test/rules/account-deletion.test.ts). Behaviour is
    // identical to the former inline version. BIN-22: username resolves
    // AUKTORITATIVT from the profile-doc inside collectDeletionRefs (React-state
    // `user?.username` is only the fallback when the profile hasn't loaded).
    const plan = await collectDeletionRefs(kit, id, snaps, user?.username);
    await applyDeletionPlan(kit, plan);

    // Finally remove the Firebase Auth user. Görs FÖRE cache-rensningen:
    // failar deleteUser (vanligast auth/requires-recent-login) finns kontot
    // kvar och då ska cachen också vara kvar — användaren re-auth:ar och
    // försöker igen mot en fräsch instans.
    await deleteUser(currentUser);

    // GDPR: utan rensning ligger den raderade användarens watchlist m.m.
    // kvar i IndexedDB på enheten. Fel sväljs i helpern.
    await clearFirestorePersistence();
  }, [user?.username]);

  const value = useMemo(
    () => ({
      user, uid, loading, profileLoading, emailVerified,
      signIn, signInEmail, register, resendEmailVerification, signOut,
      updateProviders, updateDefaultView, updateProviderCosts, updateHomeMunicipality, updateRotationSchedule, setProviderCost, setProviderRenewalDay, updateProviderTier,
      pauseProvider, resumeProvider,
      updateUsername, updateBio, updateDefaultVisibility, updateIsPublic, markNotificationsSeen, updateNotificationSettings, updateHideNonLatinTitles, updateHiddenCountries,
      setCalibrationGenres, deleteAccount,
    }),
    [
      user, uid, loading, profileLoading, emailVerified,
      signIn, signInEmail, register, resendEmailVerification, signOut,
      updateProviders, updateDefaultView, updateProviderCosts, updateHomeMunicipality, updateRotationSchedule, setProviderCost, setProviderRenewalDay, updateProviderTier,
      pauseProvider, resumeProvider,
      updateUsername, updateBio, updateDefaultVisibility, updateIsPublic, markNotificationsSeen, updateNotificationSettings, updateHideNonLatinTitles, updateHiddenCountries,
      setCalibrationGenres, deleteAccount,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
