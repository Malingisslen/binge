'use client';

import { createContext, useContext, useMemo, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
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
  getIdTokenResult,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { fsdb, getDb, clearFirestorePersistence } from '@/lib/firebase/db';
import { initAppCheck } from '@/lib/firebase/appCheck';
import { collectUserDataSnapshots } from '@/lib/firebase/userData';
import { collectDeletionRefs, applyDeletionPlan } from '@/lib/firebase/accountDeletion';
import { syncMyPublicProfile, clearPublicProfileSignature } from '@/lib/firebase/publicProfile';
import { disablePushForUser, clearLocalPushTokenId, hasLocalPushToken } from '@/lib/firebase/messaging';
import { clearAllInviteTokens } from '@/lib/groupInviteCache';
import { CURRENT_TERMS_VERSION } from '@/lib/legal';
import { getProvider, canonicalProviderId } from '@/lib/tmdb/providers';
import { resolveEffectiveMonthlyCost } from '@/lib/advisor/effectiveCost';
import type { ProviderCampaign } from '@/lib/advisor/campaignPricing';
import { daysBetween, todayIso } from '@/lib/utils';
import { clearNextPath } from '@/lib/nextPath';
import { markTabSession } from '@/lib/tabSession';
import { markDeletionStarted, clearDeletionStarted, isDeletionStarted, deletionMarkerKey } from '@/lib/deletionMarker';
import { mergeUserDoc, assertProfileWritable } from '@/lib/firebase/userDocWrite';
import { REQUIRES_RECENT_LOGIN, STALE_SESSION_PREFLIGHT, markHandedOff, markCascadePartial } from '@/lib/authErrors';
import { useOptimisticMirrorField } from '@/hooks/useOptimisticMirrorField';
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
  // BIN-417: sätt/ta bort EN providers tidsbegränsade kampanj (null = ta bort).
  // Lagrar RÅTT { monthlyCost, endDate } (aldrig ett resolvat pris), keyat på
  // kanoniskt id. Samma funktionella-merge-härdning som setProviderCost.
  setProviderCampaign: (providerId: number, campaign: ProviderCampaign | null) => Promise<void>;
  pauseProvider: (providerId: number, resumeAt?: string | null) => Promise<void>;
  resumeProvider: (providerId: number) => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
  updateBio: (bio: string) => Promise<void>;
  updateDefaultVisibility: (visibility: ItemVisibility) => Promise<void>;
  /**
   * BIN-587: true när profilens defaultVisibility ÄR sparad men stämplingen av
   * watchlist-items inte gick igenom — dvs items kan fortfarande vara läsbara
   * enligt den GAMLA (mer öppna) inställningen. Settings visar det för
   * användaren; nästa app-load kör om stämplingen tills flaggan rensas.
   */
  visibilitySyncPending: boolean;
  /**
   * BIN-816: this device started deleting THIS account and never finished, so
   * `user` is null by design rather than by failure. `AppShell` renders the
   * limbo screen instead of the app — which is what makes the state *blocked*
   * rather than merely explained (Malin's call 2026-08-13, ADR 0020).
   */
  deletionInProgress: boolean;
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
  setProviderCampaign: async () => {},
  pauseProvider: async () => {},
  resumeProvider: async () => {},
  updateUsername: async () => {},
  updateBio: async () => {},
  updateDefaultVisibility: async () => {},
  visibilitySyncPending: false,
  deletionInProgress: false,
  markNotificationsSeen: async () => {},
  updateNotificationSettings: async () => {},
  updateIsPublic: async () => {},
  updateHideNonLatinTitles: async () => {},
  updateHiddenCountries: async () => {},
  setCalibrationGenres: async () => {},
  deleteAccount: async () => {},
});

// Säkerhetsgranskning 2026-08-05: Firebase kräver en "recent login" för
// destruktiva auth-operationer (deleteUser kastar auth/requires-recent-login)
// och drar gränsen vid ~5 minuters token-ålder.
// Vi drar vår egen gräns snävare: mellan kontrollen och deleteUser
// ligger hela Firestore-raderingen, och den tar tid. Marginalen är skillnaden
// mellan "vi vände bort dig med all data kvar" och "vi hann radera allt först".
//
// DBA-panelen 2026-08-05: marginalen måste dominera kaskadens värsta fall, inte
// nätt och jämnt täcka det. collectDeletionRefs går sekventiellt per grupp och
// per recension (en round-trip var), så ett tungt konto kan ta tiotals sekunder
// — och Firebase ~5-minutersgräns är inte ett publicerat kontrakt vi får pressa.
// 2 min lämnar ~3 min marginal i stället för ~1. Kostnaden är noll i praktiken:
// den som nekas måste logga in igen ändå, och gör då om försöket på sekunder.
const RECENT_LOGIN_MAX_AGE_MS = 2 * 60 * 1000;

// BIN-844: how long sign-out waits for the push token to be unregistered before
// giving up and signing out anyway. Long enough for a normal round-trip, short
// enough that nobody experiences it as a stuck button.
const PUSH_UNREGISTER_TIMEOUT_MS = 2000;

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

// Bygger en UserProfile från en redan-existerande users/{uid}-doc. Delad av
// båda ensureUserProfile-vägarna som kan mötas av en existerande doc: den
// vanliga (första getDoc:en ser den) och BIN-535-racefallet (doc:en dök upp
// MELLAN vår getDoc och create-transaktionen — se ensureUserProfile nedan).
async function buildExistingProfile(data: Record<string, unknown>, firebaseUser: User): Promise<UserProfile> {
  const isPublicLegacy = (data.isPublic as boolean) ?? false;
  const existing: UserProfile = {
    displayName: (data.displayName as string) ?? firebaseUser.displayName ?? '',
    email: (data.email as string) ?? firebaseUser.email ?? '',
    photoURL: (data.photoURL as string | null) ?? firebaseUser.photoURL,
    username: (data.username as string) ?? null,
    bio: (data.bio as string) ?? '',
    // Lazy migration: legacy isPublic-boolean → tre-state defaultVisibility.
    // Skrivs aldrig tillbaka här — bara nästa gång användaren ändrar något.
    defaultVisibility: (data.defaultVisibility as ItemVisibility) ?? (isPublicLegacy ? 'public' : 'private'),
    isPublic: isPublicLegacy,
    myProviders: (data.myProviders as number[]) ?? [],
    defaultView: (data.defaultView as UserProfile['defaultView']) ?? 'table',
    hideNonLatinTitles: (data.hideNonLatinTitles as boolean) ?? false,
    hiddenCountries: (data.hiddenCountries as string[]) ?? [],
    providerCosts: (data.providerCosts as Record<number, number>) ?? {},
    providerTiers: (data.providerTiers as Record<number, string>) ?? {},
    providerCampaigns: (data.providerCampaigns as UserProfile['providerCampaigns']) ?? {},
    providerRenewalDays: (data.providerRenewalDays as Record<number, number>) ?? {},
    providerPauses: (data.providerPauses as UserProfile['providerPauses']) ?? {},
    calibrationGenres: (data.calibrationGenres as Record<number, number> | null) ?? null,
    hemkommun: (data.hemkommun as string | null) ?? null,
    createdAt: (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? new Date(),
    updatedAt: (data.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? new Date(),
    termsAcceptedAt: (data.termsAcceptedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
    termsVersion: data.termsVersion as string | undefined,
    ageConfirmedAt: (data.ageConfirmedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
    onboardingCompletedAt: (data.onboardingCompletedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
    lastNotificationsSeenAt: (data.lastNotificationsSeenAt as { toDate?: () => Date } | undefined)?.toDate?.(),
    isAdmin: (data.isAdmin as boolean) ?? false,
    notificationSettings: {
      newEpisodes: (data.notificationSettings as UserProfile['notificationSettings'])?.newEpisodes ?? true,
      availableOnMyServices: (data.notificationSettings as UserProfile['notificationSettings'])?.availableOnMyServices ?? true,
      pushEnabled: (data.notificationSettings as UserProfile['notificationSettings'])?.pushEnabled ?? false,
      episodeReleases: (data.notificationSettings as UserProfile['notificationSettings'])?.episodeReleases ?? true,
      priceDrops: (data.notificationSettings as UserProfile['notificationSettings'])?.priceDrops ?? false,
      rotationReminders: (data.notificationSettings as UserProfile['notificationSettings'])?.rotationReminders ?? false,
      weeklyDigest: (data.notificationSettings as UserProfile['notificationSettings'])?.weeklyDigest ?? false,
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

// BIN-587: stämplar effectiveVisibility (+ legacy isPublic-spegeln) på varje
// watchlist-item UTAN egen per-item-override. Bruten ut ur
// updateDefaultVisibility så samma kod kan köras om som reparation vid nästa
// app-load. KASTAR vid fel — anroparen avgör om det blir en pending-flagga
// eller ett tyst omförsök; den får aldrig svälja felet igen (det var precis
// det som lät en privat-ställning lämna items publikt läsbara).
// `isCurrent` låter en stämpling som blivit ERSATT av ett nyare val avbryta
// efter läsningen istället för att skriva sitt gamla värde (se
// runVisibilityCascade).
async function cascadeVisibilityToItems(
  uid: string,
  visibility: ItemVisibility,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const { db, collection, getDocs, writeBatch } = await fsdb();
  const isPublicMirror = visibility === 'public';
  const snap = await getDocs(collection(db, 'users', uid, 'watchlist'));
  // Användaren hann välja något nyare medan vi läste — då är VÅRT värde
  // inaktuellt och batcharna ska inte skrivas alls.
  if (!isCurrent()) return;
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
}

// BIN-587: persistera "stämplingen är inte klar" på profil-docen. Fältet läses
// vid nästa inloggning (ensureUserProfile) och driver både varningen i Settings
// och omförsöket. Rensas med deleteField så docen inte samlar false-skräp.
async function writeVisibilitySyncPending(uid: string, pending: boolean): Promise<void> {
  await mergeUserDoc(uid, kit => ({
    visibilitySyncPending: pending ? true : kit.deleteField(),
  }));
}

/**
 * BIN-816 — a profile load for an account whose deletion is still unfinished.
 *
 * `profile: null` is not "the read failed": it means the document is
 * deliberately absent and must stay that way. The provider surfaces it as
 * `deletionInProgress`, which `AppShell` renders as the limbo screen.
 */
interface ProfileLoad {
  profile: UserProfile | null;
  visibilitySyncPending: boolean;
  deletionInProgress: boolean;
}

async function ensureUserProfile(firebaseUser: User): Promise<ProfileLoad> {
  // BIN-816 AC1/AC3 — the resurrection itself. This function's whole job is to
  // create `users/{uid}` when it is missing, and after an aborted deletion
  // "missing" is the intended end state, not a gap to fill. Creating it here
  // wrote a fresh `termsAcceptedAt`/`ageConfirmedAt` for someone who had just
  // asked to leave — a consent record the app manufactured — and then
  // `tryAutoClaimUsername` re-reserved the handle the cascade had released.
  //
  // Returning before the transaction is what stops both, and it must come
  // before the read too: an aborted deletion leaves nothing to read, so the
  // create branch is precisely where such a session lands.
  if (isDeletionStarted(firebaseUser.uid)) {
    return { profile: null, visibilitySyncPending: false, deletionInProgress: true };
  }

  const { db, doc, getDoc, runTransaction, serverTimestamp } = await fsdb();
  const ref = doc(db, 'users', firebaseUser.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data();
    return {
      profile: await buildExistingProfile(data, firebaseUser),
      visibilitySyncPending: data.visibilitySyncPending === true,
      deletionInProgress: false,
    };
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

  // BIN-535: the getDoc above is NOT atomic with register()'s own setDoc —
  // createUserWithEmailAndPassword fires onAuthStateChanged (→ this function)
  // on the same tick register() is still awaiting updateProfile()/fsdb()
  // before its own write. A plain setDoc here would blindly overwrite
  // register()'s termsVersion/termsAcceptedAt/notificationSettings back to
  // Google-sign-in defaults if it lands second. Wrapping the check+create in
  // a transaction closes the gap: Firestore re-reads the doc inside the
  // transaction (and retries the callback if it changes before commit), so a
  // doc that appeared since our getDoc is caught here instead of clobbered.
  const racedData = await runTransaction(db, async (tx) => {
    const txSnap = await tx.get(ref);
    if (txSnap.exists()) return txSnap.data();
    tx.set(ref, {
      ...profile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      termsAcceptedAt: serverTimestamp(),
      ageConfirmedAt: serverTimestamp(),
    });
    return null;
  });

  if (racedData) {
    return {
      profile: await buildExistingProfile(racedData, firebaseUser),
      visibilitySyncPending: racedData.visibilitySyncPending === true,
      deletionInProgress: false,
    };
  }

  // Auto-föreslå username från Google displayName / email-localpart. Triggar
  // bara på doc-creation (existing-grenen kör samma helper inline).
  const claimed = await tryAutoClaimUsername(firebaseUser);
  if (claimed) profile.username = claimed;

  return { profile, visibilitySyncPending: false, deletionInProgress: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  // BIN-587: speglad i en ref eftersom både auth-effekten (tom deps) och
  // updateDefaultVisibility behöver LÄSA nuvarande värde utan att bindas om.
  const [visibilitySyncPending, setVisibilitySyncPending] = useState(false);
  const visibilitySyncPendingRef = useRef(false);
  // BIN-816 — this device started deleting THIS account and never finished.
  // Mirrors the localStorage marker into render state; the marker itself stays
  // the source of truth and is re-read at every guarded write (never cached).
  const [deletionInProgress, setDeletionInProgress] = useState(false);
  // Vilket uid vi redan gjort ett reparations-försök för i den här sessionen.
  // Ett försök per app-load — annars skulle en cascade som failar konstant
  // loopa mot Firestore (och kosta reads) hela sessionen.
  const visibilityRetriedFor = useRef<string | null>(null);
  // BIN-587: auto-omförsöket och ett manuellt val (radioknapp / "Försök igen
  // nu") stämplar SAMMA watchlist-docs. Utan ordning avgörs slutvärdet av
  // vilken batch som råkar LANDA sist — dvs en färsk "privat"-ställning kunde
  // skrivas över av omförsökets äldre "publik", och den som resolvade sist
  // rensade dessutom varningen. Tre delar håller ihop det:
  //   epoken  — bumpas SYNKRONT när en stämpling begärs, så körningarna
  //             rangordnas efter när användaren valde, inte efter nätverket;
  //             en ersatt körning skriver inget och rör inte pending-flaggan.
  //   kön     — serialiserar cascaderna så två aldrig är i luften mot samma
  //             docs samtidigt.
  //   in-flight — auto-omförsöket startar aldrig medan ett explicit val är på
  //             väg ner (dess värde är per definition färskare än vårt).
  const visibilityEpoch = useRef(0);
  const visibilityQueue = useRef<Promise<void>>(Promise.resolve());
  const visibilityWritesInFlight = useRef(0);
  const markVisibilitySyncPending = useCallback(async (targetUid: string, pending: boolean) => {
    if (visibilitySyncPendingRef.current === pending) return;
    visibilitySyncPendingRef.current = pending;
    setVisibilitySyncPending(pending);
    try {
      await writeVisibilitySyncPending(targetUid, pending);
    } catch (err) {
      // Flagg-writen kan falla på samma nätverksfel som cascaden. Lokalt state
      // står kvar (varningen syns den här sessionen) — men vi låtsas inte att
      // den överlevde till nästa load.
      console.error('[visibilitySyncPending flag]', err);
    }
  }, []);

  // Kör stämplingen i kön och bara så länge `epoch` fortfarande är den senast
  // begärda. 'applied' = den här körningen är den som gäller (anroparen får
  // röra pending-flaggan). 'superseded' = ett nyare val har tagit över och
  // äger både skrivningen och flaggan — anroparen ska då INTE rapportera
  // något utfall, varken lyckat eller misslyckat.
  const runVisibilityCascade = useCallback(
    (targetUid: string, visibility: ItemVisibility, epoch: number): Promise<'applied' | 'superseded'> => {
      const isCurrent = () => visibilityEpoch.current === epoch;
      const run = visibilityQueue.current.then(async () => {
        if (!isCurrent()) return 'superseded' as const;
        try {
          await cascadeVisibilityToItems(targetUid, visibility, isCurrent);
        } catch (err) {
          // Ett fel i en redan ersatt körning säger inget om slutläget.
          if (!isCurrent()) return 'superseded' as const;
          throw err;
        }
        return isCurrent() ? 'applied' as const : 'superseded' as const;
      });
      // Kön får aldrig gå sönder av ett fel — nästa stämpling ska köra ändå.
      visibilityQueue.current = run.then(() => {}, () => {});
      return run;
    },
    [],
  );

  // BIN-732 — has this tab ever HELD a session? A remembered return path is only
  // dangerous once a signed-in user has been here: `uid` going set→null is a
  // handover, while `uid` arriving as null is just a signed-out visitor booting
  // (whose path a poster-badge tap may legitimately have stored a moment ago).
  // A ref, not state: it is read inside the auth callback, which never re-binds.
  const hadSessionRef = useRef(false);

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
          hadSessionRef.current = true;
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
            .then(({ profile, visibilitySyncPending: pending, deletionInProgress: deleting }) => {
              // Account-switch-skydd: skriv bara om samma användare
              // fortfarande är inloggad när profilen landar.
              if (auth.currentUser?.uid !== firebaseUser.uid) return;
              setUser(profile);
              // BIN-816: en påbörjad radering är inte ett laddningsfel — appen
              // ska visa limbo-skärmen, inte sitt vanliga skal.
              //
              // Markören läses OM här, inte bara vidare från `deleting`.
              // `ensureUserProfile` samplade den för hundratals millisekunder
              // sedan, och startar en annan flik en radering under tiden hinner
              // storage-lyssnaren nedan sätta flaggan till true — som det här
              // svaret sedan skrev tillbaka till false, permanent, eftersom
              // inget nytt storage-event kommer förrän markören ändras igen.
              // Fliken blev då fullt skrivbar mitt i en pågående radering
              // (integrationsgranskningen 2026-08-13). Filen egen regel är att
              // markören läses färskt vid varje grindat ställe; det här var det
              // enda stället som cachade den.
              setDeletionInProgress(deleting || isDeletionStarted(firebaseUser.uid));
              // BIN-587: en tidigare misslyckad synlighets-stämpling plockas
              // upp här och driver både varningen och omförsöks-effekten.
              visibilitySyncPendingRef.current = pending;
              setVisibilitySyncPending(pending);
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
          // BIN-732 — the sign-out itself, not the tab that asked for it.
          // Firebase broadcasts a sign-out to every tab on the origin, but the
          // BIN-669 flag it replaces lived in ONE tab's memory: a second tab
          // parked on a guarded page also went uid→null, its own provider had
          // never called `signOut`, and so it stored the departing user's page
          // as the next account's return path. On a shared device the next
          // person inherits it, and a remembered path outlives onboarding —
          // `/grupper/<id>/` then discloses the group's name and memberUids
          // (firestore.rules allows any signed-in read on the group doc; the
          // "Firestore denies it anyway" reassurance was never true there).
          // Listening to the TRANSITION covers every tab and every cause,
          // including a revoked or expired session. The cost is that such a
          // session-loss also forgets where the visitor was — accepted: the
          // guard re-remembers the moment they hit a guarded page signed-out.
          if (hadSessionRef.current) {
            hadSessionRef.current = false;
            clearNextPath();
          }
          setUser(null);
          setUid(null);
          setEmailVerified(false);
          setProfileLoading(false);
          // BIN-816: the limbo screen belongs to a SIGNED-IN marked session. A
          // signed-out visitor gets the normal app — the marker is uid-scoped and
          // still there for whoever signs back into that account. Not clearing it
          // here would leave the limbo screen up for the next, unrelated account
          // on a shared device.
          setDeletionInProgress(false);
          visibilitySyncPendingRef.current = false;
          setVisibilitySyncPending(false);
          // BIN-617: the auto-repair is latched to one attempt per uid per app
          // LOAD, and this branch is the only place a load can start over without
          // a page reload. Signing out and back in as the same uid otherwise
          // inherited the spent latch, so that session got no automatic retry —
          // the pending flag stayed, the Settings warning stayed, and repairing
          // it needed the manual "Försök igen nu" button. Nothing leaks either
          // way (the flag is what holds the warning up), it just costs a free
          // attempt. Reset here, with the rest of the per-user state.
          visibilityRetriedFor.current = null;
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

  // BIN-748 — keep a record of which page this tab is showing a session on,
  // somewhere a RELOAD of the tab can still read it. `hadSessionRef` dies with
  // the page, so a tab that re-boots between a sign-out (in another tab, or a
  // revoked token) and its own next verdict has no way to know it was showing a
  // session a moment ago, and its AuthGuard would store the departing user's URL
  // as the next sign-in's landing page (see lib/tabSession.ts).
  //
  // Re-runs per navigation, on purpose. The marker is never retired: a guard on
  // any OTHER page sees a path that doesn't match and treats its own signed-out
  // verdict as the real bounce it is (BIN-645). That is what makes this immune
  // to mount order — the catch-all router's pages (`/grupper/<id>/`) mount their
  // guard a commit or two late, after a `next/dynamic` chunk lands, and a marker
  // that had to be cleared "at the right moment" was already gone by then.
  useEffect(() => {
    if (!uid) return;
    markTabSession(pathname);
  }, [uid, pathname]);

  // BIN-816 — a tab that was ALREADY open when the deletion started.
  //
  // `deletionInProgress` is otherwise only decided at profile load, and a tab
  // that is already rendering the app never runs that again. So the deletion
  // could start in tab A while tab B kept the full shell — and everything
  // mounted ABOVE `AppShell` (`WatchlistProvider` above all) kept writing
  // owner-scoped documents, which `isOwner(uid)` permits with no profile
  // document in existence. Those writes then survive both the cascade and the
  // server sweep, which is personal data outliving an Art. 17 request rather
  // than merely an untidy screen (security review, 2026-08-13).
  //
  // `storage` fires in every OTHER tab on the origin, which is exactly the set
  // that needs telling. A `null` key means the whole store was cleared, so
  // re-read then too rather than assuming it was someone else's key.
  useEffect(() => {
    if (!uid) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== deletionMarkerKey(uid)) return;
      setDeletionInProgress(isDeletionStarted(uid));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [uid]);

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

  // BIN-505: keep MY public projection (publicProfiles/{uid}) in sync with my
  // display fields. Covers backfill for existing users (projection missing) AND
  // drift-repair when name/username/photo/bio change. syncMyPublicProfile is
  // best-effort + skips a no-op write via a stored signature, so this effect is
  // cheap on steady state. A stale projection is only a cosmetic stale name —
  // visibility is gated live by the rule — so a missed sync never leaks.
  useEffect(() => {
    if (!uid || !user) return;
    // BIN-816 AC2: the cascade deletes publicProfiles/{uid}, and this effect is
    // the second resurrection path — it would rebuild the projection from React
    // state on the very next render. syncMyPublicProfile refuses the write on
    // its own too (userDocWrite.mergePublicProfileDoc); this is the cheap
    // early-out that also skips the signature read.
    if (deletionInProgress) return;
    void syncMyPublicProfile(uid, {
      displayName: user.displayName,
      username: user.username,
      photoURL: user.photoURL,
      bio: user.bio,
      isPublic: user.isPublic,
      createdAt: user.createdAt,
    });
  }, [uid, deletionInProgress, user?.displayName, user?.username, user?.photoURL, user?.bio, user?.isPublic, user?.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // BIN-587: reparera en cascade som failade. Profilen kan säga 'private'
  // medan items fortfarande bär effectiveVisibility:'public' — och läs-regeln
  // litar på item-fältet utan att slå upp profilen, så läckan består tills
  // någon stämplar om. Vi kör om stämplingen mot profilens NUVARANDE värde
  // (steg 1 committar alltid först, så det är sanningen) en gång per app-load
  // tills den lyckas och flaggan rensas.
  const pendingVisibilityTarget = user?.defaultVisibility;
  useEffect(() => {
    if (!uid || !pendingVisibilityTarget || !visibilitySyncPending) return;
    // BIN-816: the repair stamps users/{uid}/watchlist/* for an account whose
    // deletion is running. Those documents are queued for erasure, not for a
    // visibility fix — and a marked session must not write at all (Malin's call
    // 2026-08-13, ADR 0020). The flag it would clear lives on a profile document
    // that is already gone.
    if (deletionInProgress) return;
    if (visibilityRetriedFor.current === uid) return;
    // Ett explicit val är redan på väg ner. Det bär ett färskare värde än vårt
    // och stämplar samma docs — låt det äga både skrivningen och flaggan.
    // Kvoten lämnas orörd: ändras pending/target när det landar får effekten
    // en ny chans att bedöma läget.
    if (visibilityWritesInFlight.current > 0) return;
    visibilityRetriedFor.current = uid;
    const epoch = ++visibilityEpoch.current;
    void runVisibilityCascade(uid, pendingVisibilityTarget, epoch)
      .then(outcome => outcome === 'applied' ? markVisibilitySyncPending(uid, false) : undefined)
      .catch(err => console.error('[visibilitySyncPending retry]', err));
  }, [uid, deletionInProgress, pendingVisibilityTarget, visibilitySyncPending, markVisibilitySyncPending, runVisibilityCascade]);

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
    // BIN-816: through the chokepoint like every other users/{uid} write. A
    // brand-new uid can never carry a deletion marker, so the gate is a no-op
    // here — it is uniformity that keeps the chokepoint test meaningful.
    await mergeUserDoc(cred.user.uid, kit => ({
      displayName: name,
      email: cred.user.email ?? email,
      photoURL: cred.user.photoURL,
      // OBS: inget `username: null` här (BIN-517) — den här writen racear
      // onAuthStateChanged → ensureUserProfile → tryAutoClaimUsername, och
      // med merge:true skulle en explicit null klobbra ett just-claimat
      // username tillbaka till null (medan usernames/{name}-reservationen
      // står kvar). Saknat fält normaliseras till null av alla läsare, och
      // ensureUserProfile:s backfill auto-claimar då på nästa sign-in.
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
      termsAcceptedAt: kit.serverTimestamp(),
      termsVersion,
      ageConfirmedAt: kit.serverTimestamp(), // BIN-348: the register form gates on the 13+ checkbox; record it.
      createdAt: kit.serverTimestamp(),
    }));
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
    // BIN-669/732: a path an earlier tap stored in this tab is not this
    // handover's business. Cleared BEFORE the sign-out, synchronously with the
    // click — the auth listener's own clear (see the uid set→null branch) is
    // what reaches the OTHER tabs, but it lands a network round-trip later and
    // never lands at all if `firebaseSignOut` throws.
    clearNextPath();
    // BIN-844: unregister push BEFORE the sign-out, and capture the uid first.
    //
    // Two orderings are load-bearing and neither is obvious:
    //  1. `auth.currentUser` is null the moment `firebaseSignOut` resolves, so the
    //     uid is unrecoverable afterwards.
    //  2. `disablePushForUser` DELETES users/{uid}/fcmTokens/{id}. Once the Auth
    //     user is gone the client holds no token and firestore.rules refuses that
    //     write. This is deleteAccount's ordering rule pointing the other way:
    //     there the local cleanup must FOLLOW the point of no return, here the
    //     server-side cleanup must PRECEDE it.
    //
    // It also means this cannot live in the auth listener's uid→null branch where
    // the rest of the sign-out hygiene sits (BIN-732) — by the time that branch
    // runs the write is already impossible. So a session ending by silent expiry
    // or revocation keeps pushing to this device: a known gap, not an oversight.
    //
    // Best-effort. Offline, or a denied write, leaves the token registered and push
    // still arriving here. Never block the sign-out over it — a user who cannot
    // sign out is worse off than one whose notifications follow them.
    const signingOutUid = auth.currentUser?.uid;
    if (signingOutUid && hasLocalPushToken(signingOutUid)) {
      // The timeout is not belt-and-braces, it is the whole guard. `deleteDoc`
      // against persistentLocalCache resolves on SERVER ACK, so offline it never
      // settles at all — a bare `await` here would hang sign-out forever, silently,
      // for exactly the users who have push on. Neither call site surfaces anything —
      // one is `void signOut()`, the other passes it straight to onClick — so there
      // would be no spinner and no error: the visitor would simply stay signed in on
      // the shared device, which is the leak this ticket exists to close. Catching a
      // rejection does not cover a hang.
      //
      // A delete that has not been acked when the timer wins is discarded by the
      // `clearFirestorePersistence()` below — same outcome as an offline failure
      // today (the token survives, push keeps arriving), not a new failure mode.
      await Promise.race([
        disablePushForUser(signingOutUid).catch(() => { /* best-effort — see above */ }),
        new Promise<void>(resolve => setTimeout(resolve, PUSH_UNREGISTER_TIMEOUT_MS)),
      ]);
    }
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
    await mergeUserDoc(uid, { [field]: value });
    setUser(prev => prev ? { ...prev, [field]: value } : null);
  }, [uid]);

  const updateProviders = useCallback(async (providers: number[]) => {
    await updateUserField('myProviders', providers);
    if (!uid) return;
    // Provider-drift (Fas 2): propagera ändringen till gruppmedlemskap så
    // gruppens intersect/union hålls aktuell utan att medlemmen behöver
    // gå in i varje grupp och uppdatera.
    const { updateMemberProviders, MY_GROUPS_LIMIT } = await import('@/lib/firebase/groups');
    const { db, collection: col, getDocs: get, query: q, where, limit: lim } = await fsdb();
    // BIN-536: samma read-cap-mönster som groups.ts fyra motsvarande queries
    // (BIN-510) — obegränsad array-contains-query är ett latent read-bomb-hot
    // mot Blaze-taket. Delar groups.ts:s MY_GROUPS_LIMIT-konstant (importerad,
    // inte en egen lokal kopia) så de två inte kan divergera.
    const snap = await get(q(col(db, 'groups'), where('memberUids', 'array-contains', uid), lim(MY_GROUPS_LIMIT)));
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
  // BIN-561: de tre provider-map-setter:na (kostnad, kampanj, förnyelsedag)
  // delar spegel-plus-rollback-mönstret via useOptimisticMirrorField — se den
  // hooken för VARFÖR spegeln uppdateras synkront (BIN-40/46) och rullas
  // tillbaka identity-checkat vid write-fel (BIN-516/531).
  const commitProviderCosts = useCallback(
    (next: Record<number, number>) => updateUserField('providerCosts', next),
    [updateUserField],
  );
  const setProviderCost = useOptimisticMirrorField(uid, user?.providerCosts, commitProviderCosts);
  // BIN-417: kampanjer lagrar RÅA { monthlyCost, endDate } keyed by CANONICAL
  // id (så ett alias-id och dess kanoniska träffar samma post, i linje med
  // resolveEffectiveMonthlyCost). Kanoniseringen sker här, inte i hooken.
  const commitProviderCampaigns = useCallback(
    (next: Record<number, ProviderCampaign>) => updateUserField('providerCampaigns', next),
    [updateUserField],
  );
  const setCampaignByKey = useOptimisticMirrorField(uid, user?.providerCampaigns, commitProviderCampaigns);
  const setProviderCampaign = useCallback(
    (providerId: number, campaign: ProviderCampaign | null) =>
      setCampaignByKey(canonicalProviderId(providerId), campaign),
    [setCampaignByKey],
  );

  // BIN-184: hushålls-fan-out — när kostnadsrelaterade profilfält ÄNDRAS
  // uppdateras användarens opt-in-bidrag i alla grupper (dirty-checkat, så en
  // oförändrad payload aldrig ger en write). Effekt-driven istället för fem
  // call-sites: updateUserField's setUser bevarar orörda fält-referenser, så
  // deps:en triggar bara på verkliga ändringar. Första körningen per inloggning
  // hoppas över (profil-laddning ≠ ändring — sparar onödiga reads varje session).
  const householdSyncArmed = useRef(false);
  useEffect(() => { householdSyncArmed.current = false; }, [uid]);
  const hhProviders = user?.myProviders;
  const hhCosts = user?.providerCosts;
  const hhTiers = user?.providerTiers;
  const hhCampaigns = user?.providerCampaigns;
  useEffect(() => {
    if (!uid || !user) return;
    if (!householdSyncArmed.current) { householdSyncArmed.current = true; return; }
    const t = setTimeout(() => {
      import('@/lib/firebase/groups')
        .then(({ refreshMyHouseholdContributions }) =>
          refreshMyHouseholdContributions(uid, {
            myProviders: hhProviders ?? [],
            providerCosts: hhCosts ?? {},
            providerTiers: hhTiers ?? {},
            providerCampaigns: hhCampaigns ?? {},
          }),
        )
        .catch(() => {}); // best-effort — profiländringen är redan sparad
    }, 2000); // koalescera snabba successiva redigeringar till EN fan-out
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, hhProviders, hhCosts, hhTiers, hhCampaigns]);
  const commitProviderRenewalDays = useCallback(
    (next: Record<number, number>) => updateUserField('providerRenewalDays', next),
    [updateUserField],
  );
  const setProviderRenewalDay = useOptimisticMirrorField(uid, user?.providerRenewalDays, commitProviderRenewalDays);
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

    await mergeUserDoc(uid, { providerTiers: nextTiers, providerCosts: nextCosts });
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
    // BIN-417: snapshot the EFFECTIVE cost at resume — if a campaign was active
    // during the pause, that's the price that actually applied.
    const monthlyCost = resolveEffectiveMonthlyCost(providerId, {
      providerTiers: user?.providerTiers,
      providerCosts: user?.providerCosts,
      providerCampaigns: user?.providerCampaigns,
    }, new Date()) ?? 0;
    // Minst 1 dag — annars hamnar pause-then-instant-resume-test som 0 kr.
    const durationDays = Math.max(1, daysBetween(pause.pausedAt));
    const savedAmount = Math.round((monthlyCost * durationDays) / 30);

    const next = { ...current };
    delete next[providerId];

    // Atomisk batch: skriv historik-doc + uppdaterade providerPauses i ett
    // svep. Om något steg failar rullas båda tillbaka, så vi får inga
    // orfaner — antingen är pausen kvar OCH historiken oskriven, eller så
    // är pausen borta OCH historiken sparad.
    //
    // BIN-816: en av två skrivare som INTE kan gå via mergeUserDoc, eftersom
    // users/{uid} här ingår i en större atomisk batch. Grinden anropas direkt
    // i stället — samma implementation, en annan ingång (userDocWrite.ts).
    assertProfileWritable(uid);
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
    // Ta epok + in-flight SYNKRONT, före första await:en: ordningen ska följa
    // användarens klick, inte vilken write som råkar landa först.
    const epoch = ++visibilityEpoch.current;
    visibilityWritesInFlight.current += 1;
    try {
      // Stega 1: uppdatera profil-fältet (+ legacy isPublic-mirror för bakåt-
      // kompatibilitet i rules under migrationsperioden).
      const isPublicMirror = visibility === 'public';
      await mergeUserDoc(uid, { defaultVisibility: visibility, isPublic: isPublicMirror });
      setUser(prev => prev ? { ...prev, defaultVisibility: visibility, isPublic: isPublicMirror } : null);

      // Stega 2: cascade till alla watchlist-items utan explicit per-item-
      // override. Firestore-regler kan inte joina mot parent-user-doc per item,
      // så vi denormaliserar 'effectiveVisibility' (+ legacy isPublic-mirror) på
      // varje item-doc. Items som har egen 'visibility'-override lämnas orörda.
      try {
        const outcome = await runVisibilityCascade(uid, visibility, epoch);
        // Ersatt av ett nyare val: den körningen äger utfallet. Att rensa
        // flaggan här hade sagt "synkat" om ETT ANNAT värde än det som gäller.
        if (outcome === 'superseded') return;
        // BIN-587: lyckad stämpling reparerar även ett tidigare misslyckat
        // försök — rensa flaggan (no-op när den inte var satt).
        await markVisibilitySyncPending(uid, false);
      } catch (err) {
        console.error('[defaultVisibility cascade]', err);
        // BIN-587: profilen säger nu t.ex. 'privat' medan items fortfarande kan
        // vara publikt läsbara — den farliga riktningen. Flagga det istället för
        // att bara logga: Settings visar att ändringen inte är klar och nästa
        // app-load kör om stämplingen. Försöks-kvoten för den här sessionen är
        // förbrukad här, så omförsöket sker vid nästa load (inte i en tight loop).
        visibilityRetriedFor.current = uid;
        await markVisibilitySyncPending(uid, true);
      }
    } finally {
      visibilityWritesInFlight.current -= 1;
    }
  }, [uid, markVisibilitySyncPending, runVisibilityCascade]);

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
    await mergeUserDoc(uid, kit => ({ lastNotificationsSeenAt: kit.serverTimestamp() }));
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
    await mergeUserDoc(uid, { notificationSettings: merged });
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

  /**
   * The irreversible half, extracted so `deleteAccount` can wrap exactly the
   * region that runs AFTER the marker goes down — no more and no less. Anything
   * thrown from in here means the account survived an attempt that had already
   * started, which is the definition of limbo.
   */
  const runDeletionCascade = useCallback(async (currentUser: User, id: string) => {
    // Delad läsning med buildUserExport — om nya user-owned collections
    // läggs till ska de uppdateras i collectUserDataSnapshots.
    const snaps = await collectUserDataSnapshots(id);
    const kit = await fsdb();

    // Cascade-plan + commit are extracted (BIN-347) into pure, db-injectable
    // helpers so the Art. 17 erasure path can be run end-to-end against the
    // Firestore emulator (src/test/rules/account-deletion.test.ts). Behaviour is
    // identical to the former inline version. BIN-875: the username reservation
    // is resolved by QUERYING `usernames` on uid inside collectDeletionRefs.
    // There is deliberately NO fallback — the profile doc and the old React-state
    // argument both die in the same interrupted attempt, which is exactly when a
    // retry needs the reservation, and queuing an unverified name would throw
    // inside the atomic chunk that also carries users/{uid} (see
    // collectUsernameReservationRefs).
    const plan = await collectDeletionRefs(kit, id, snaps);
    await applyDeletionPlan(kit, plan);

    // Finally remove the Firebase Auth user. Görs FÖRE cache-rensningen: failar
    // deleteUser finns kontot kvar och då ska cachen också vara kvar —
    // användaren försöker igen mot en fräsch instans. Efter freshness-porten
    // ovan är det som återstår här nät-fel, och då är omförsöket den enda
    // återställningen.
    //
    // BIN-875 korrigerar vad som stod här förut: kaskaden beskrevs som idempotent
    // ("kör om mot redan tom data"), och det var sant för allt UTOM
    // användarnamnsreservationen — den löstes upp ur profil-docen som första
    // försöket redan hade raderat, så ett omförsök tappade den tyst och handtaget
    // blev upptaget för alltid. Med uid-frågan i collectDeletionRefs stämmer
    // påståendet: raderingar mot redan raderade dokument är no-ops, uppdateringarna
    // riktar sig mot ANDRA användares dokument som kaskaden aldrig rör, och
    // reservationen hittas oavsett vad som redan är borta.
    try {
      await deleteUser(currentUser);
    } catch (err) {
      // BIN-876: everything above this line succeeded, so by the time we get here
      // the person's data IS gone and only the identity remains. Firebase's own
      // `requires-recent-login` already has a branch that says so; every OTHER
      // failure here (a network drop, most of all) used to fall through to the
      // generic message — the one that says nothing was deleted. Tagging it is
      // what stops that message being a lie about the biggest possible case.
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.includes(REQUIRES_RECENT_LOGIN)) throw err;
      throw markCascadePartial(err);
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const id = currentUser.uid;

    // Säkerhetsgranskning 2026-08-05: freshness-kontrollen MÅSTE ligga före den
    // oåterkalleliga Firestore-raderingen. Ordningen var tvärtom: hela kontot
    // raderades först och deleteUser kastade sedan requires-recent-login — det
    // VANLIGASTE utfallet av ett verkligt klick, eftersom sessionen sällan är
    // under 5 minuter gammal.
    // Användaren såg "Du måste logga in igen", trodde att ingenting hänt, och hade
    // i själva verket redan förlorat bibliotek, betyg och avsnittsprogress medan
    // Auth-kontot (e-post + uid) levde vidare — en halv Art. 17-radering.
    //
    // Att i stället köra deleteUser FÖRST går inte: när Auth-användaren är borta
    // har klienten ingen token, och firestore.rules avvisar varenda write i
    // kaskaden. Så vi frågar token:en om sin ålder innan något raderas, och
    // vänder bort en gammal session med allt i behåll. Kastar getIdTokenResult
    // (offline/nätfel) avbryter vi också — fail closed, ingenting är rört ännu.
    const { authTime } = await getIdTokenResult(currentUser);
    const sessionAgeMs = Date.now() - new Date(authTime).getTime();
    // Negerad jämförelse, inte `>=`: ett oparsbart authTime ger NaN, och NaN ska
    // leda till re-auth — inte till att kaskaden rullar vidare på en tyst false.
    if (!(sessionAgeMs < RECENT_LOGIN_MAX_AGE_MS)) {
      // Bär BÅDA koderna: `requires-recent-login` är vad varje befintlig läsare
      // (och Firebase självt) känner igen, och preflight-koden är det som skiljer
      // "ingenting är rört" från samma fel kastat efter kaskaden — se lib/authErrors.
      throw new Error(
        `${REQUIRES_RECENT_LOGIN} (${STALE_SESSION_PREFLIGHT}): sessionen är för gammal för att radera kontot`,
      );
    }

    // BIN-816 / ADR 0019 condition 2 — the marker goes down HERE: after the
    // freshness gate has let us through, before the first read of the cascade,
    // and never on the button press. Set it at click time and a user whose
    // session was merely too old would be locked out of a fully intact account,
    // which is exactly what STALE_SESSION_PREFLIGHT exists to prevent.
    //
    // Note it is set before anything is deleted, on purpose. Between the first
    // commit and the last there is no safe moment to start: a tab that dies at
    // the wrong instant must already be marked, or the next load resurrects the
    // profile. The cost — a cascade that fails on its very first chunk parks a
    // user with all their data intact until they retry — is recorded in
    // .claude/rules/accepted-deviations.md rather than papered over.
    //
    // What is deliberately NOT done here is flipping `deletionInProgress`. The
    // marker and the render flag answer different questions, and conflating them
    // shipped a bug the integration, code and security reviews all found
    // independently: `AppShell` swaps the whole app for the limbo screen on that
    // flag, so setting it here replaced the settings page with "vi hann ta bort
    // din data" while the cascade was still READING — on the happy path, for
    // every user, for the tens of seconds a heavy account's plan build takes.
    // The marker protects the profile (it is what `ensureUserProfile` and the
    // write chokepoint read); the flag hands the session over, and it is only
    // honest to do that once the attempt has ENDED without success.
    markDeletionStarted(id, Date.now());
    try {
      await runDeletionCascade(currentUser, id);
    } catch (err) {
      // The attempt is over and the account is still here. NOW the session is in
      // limbo: the marker stands, so profile writes are refused, and the shell
      // hands over to the screen that can finish the job.
      setDeletionInProgress(true);
      throw markHandedOff(err);
    }

    // Point of no return passed — the account is gone, so there is nothing left
    // to resurrect and the marker has done its job. This is the ONLY place it is
    // cleared: there is deliberately no "I changed my mind" path, because by the
    // time the marker exists the cascade has already run.
    clearDeletionStarted(id);
    setDeletionInProgress(false);

    // GDPR: utan rensning ligger den raderade användarens watchlist m.m.
    // kvar i IndexedDB på enheten. Fel sväljs i helpern.
    await clearFirestorePersistence();

    // BIN-817: clearFirestorePersistence rör bara IndexedDB. Profilkortets
    // signaturnyckel bor i localStorage och överlevde annars raderingen. Ligger
    // HÄR, efter deleteUser, av samma skäl som cache-rensningen: kastar något i
    // kaskaden finns kontot kvar, och då ska enhetens tillstånd också göra det.
    clearPublicProfileSignature(id);
    // BIN-844: same event, same reasoning — device-local leftovers the Firestore
    // cascade cannot reach. The invite plaintexts point at groups the cascade has
    // already deleted (only an OWNER ever caches one), and the push-token pointer
    // is dangling because the cascade removed users/{uid}/fcmTokens/* itself. Both
    // are hygiene, not new Art. 17 coverage — say so rather than implying erasure.
    // Deliberately NOT swept on sign-out: that is Malin's 2026-08-10 call, see
    // clearAllInviteTokens' own comment for the owner-cost that decided it.
    clearAllInviteTokens();
    clearLocalPushTokenId(id);
  }, [runDeletionCascade]);


  const value = useMemo(
    () => ({
      user, uid, loading, profileLoading, emailVerified,
      signIn, signInEmail, register, resendEmailVerification, signOut,
      updateProviders, updateDefaultView, updateProviderCosts, updateHomeMunicipality, updateRotationSchedule, setProviderCost, setProviderRenewalDay, updateProviderTier, setProviderCampaign,
      pauseProvider, resumeProvider,
      updateUsername, updateBio, updateDefaultVisibility, visibilitySyncPending, deletionInProgress, updateIsPublic, markNotificationsSeen, updateNotificationSettings, updateHideNonLatinTitles, updateHiddenCountries,
      setCalibrationGenres, deleteAccount,
    }),
    [
      user, uid, loading, profileLoading, emailVerified,
      signIn, signInEmail, register, resendEmailVerification, signOut,
      updateProviders, updateDefaultView, updateProviderCosts, updateHomeMunicipality, updateRotationSchedule, setProviderCost, setProviderRenewalDay, updateProviderTier, setProviderCampaign,
      pauseProvider, resumeProvider,
      updateUsername, updateBio, updateDefaultVisibility, visibilitySyncPending, deletionInProgress, updateIsPublic, markNotificationsSeen, updateNotificationSettings, updateHideNonLatinTitles, updateHiddenCountries,
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
