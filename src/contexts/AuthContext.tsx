'use client';

import { createContext, useContext, useMemo, useState, useCallback, useEffect, type ReactNode } from 'react';
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
import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  writeBatch,
  serverTimestamp,
  type DocumentReference,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/config';
import { initAppCheck } from '@/lib/firebase/appCheck';
import { collectUserDataSnapshots } from '@/lib/firebase/userData';
import type { ItemVisibility, UserProfile } from '@/types';

interface AuthState {
  user: UserProfile | null;
  uid: string | null;
  loading: boolean;
  // Firebase Auth email-verification-state. Gör inte gating idag men UI:t
  // kan visa en banner när emailVerified=false (och resend därifrån).
  emailVerified: boolean;
  signIn: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, termsVersion: string) => Promise<void>;
  resendEmailVerification: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProviders: (providers: number[]) => Promise<void>;
  updateDefaultView: (view: 'table' | 'grid') => Promise<void>;
  updateProviderCosts: (costs: Record<number, number>) => Promise<void>;
  updateProviderTier: (providerId: number, tierId: string | null) => Promise<void>;
  pauseProvider: (providerId: number, resumeAt?: string | null) => Promise<void>;
  resumeProvider: (providerId: number) => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
  updateBio: (bio: string) => Promise<void>;
  updateDefaultVisibility: (visibility: ItemVisibility) => Promise<void>;
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
  emailVerified: false,
  signIn: async () => {},
  signInEmail: async () => {},
  register: async () => {},
  resendEmailVerification: async () => {},
  signOut: async () => {},
  updateProviders: async () => {},
  updateDefaultView: async () => {},
  updateProviderCosts: async () => {},
  updateProviderTier: async () => {},
  pauseProvider: async () => {},
  resumeProvider: async () => {},
  updateUsername: async () => {},
  updateBio: async () => {},
  updateDefaultVisibility: async () => {},
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
      providerPauses: (data.providerPauses as UserProfile['providerPauses']) ?? {},
      calibrationGenres: (data.calibrationGenres as Record<number, number> | null) ?? null,
      createdAt: data.createdAt?.toDate() ?? new Date(),
      updatedAt: data.updatedAt?.toDate() ?? new Date(),
      termsAcceptedAt: data.termsAcceptedAt?.toDate(),
      termsVersion: data.termsVersion as string | undefined,
      onboardingCompletedAt: data.onboardingCompletedAt?.toDate(),
      isAdmin: (data.isAdmin as boolean) ?? false,
      notificationSettings: data.notificationSettings ?? {
        newEpisodes: true,
        availableOnMyServices: true,
      },
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
    providerPauses: {},
    calibrationGenres: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    notificationSettings: {
      newEpisodes: true,
      availableOnMyServices: true,
    },
  };

  await setDoc(ref, {
    ...profile,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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

  useEffect(() => {
    // App Check MÅSTE initialiseras innan onAuthStateChanged subscribar.
    // Auth attaches App Check tokens automatiskt till alla Identity Toolkit-
    // calls (inkl. token-refresh på boot). Om App Check inte är initialiserad
    // när Auth bootar hänger Auth för evigt och väntar på en token-provider
    // som aldrig kommer. initAppCheck är idempotent — Providers kallar också,
    // men barns useEffect firar före parents så vi behöver göra det här
    // för att vinna race:t.
    initAppCheck();
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const profile = await ensureUserProfile(firebaseUser);
          setUser(profile);
          setUid(firebaseUser.uid);
          setEmailVerified(firebaseUser.emailVerified);
        } catch (err) {
          console.error('Failed to load user profile:', err);
          setUser(null);
          setUid(null);
          setEmailVerified(false);
        }
      } else {
        setUser(null);
        setUid(null);
        setEmailVerified(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
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
      providerPauses: {},
      calibrationGenres: null,
      notificationSettings: { newEpisodes: true, availableOnMyServices: true },
      termsAcceptedAt: serverTimestamp(),
      termsVersion,
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
  }, [queryClient]);

  const updateUserField = useCallback(async <K extends keyof UserProfile>(field: K, value: UserProfile[K]) => {
    if (!uid) return;
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
    const { collection: col, getDocs: get, query: q, where } = await import('firebase/firestore');
    const snap = await get(q(col(db, 'groups'), where('memberUids', 'array-contains', uid)));
    await Promise.all(
      snap.docs.map(d => updateMemberProviders(d.id, uid, providers).catch(() => {})),
    );
  }, [updateUserField, uid]);
  const updateDefaultView = useCallback((view: 'table' | 'grid') => updateUserField('defaultView', view), [updateUserField]);
  const updateProviderCosts = useCallback((costs: Record<number, number>) => updateUserField('providerCosts', costs), [updateUserField]);
  const updateProviderTier = useCallback(async (providerId: number, tierId: string | null) => {
    if (!uid || !user) return;
    const { getProvider } = await import('@/lib/tmdb/providers');
    const provider = getProvider(providerId);
    const tier = tierId ? provider?.tiers?.find(t => t.id === tierId) : null;

    const nextTiers = { ...(user.providerTiers ?? {}) };
    const nextCosts = { ...(user.providerCosts ?? {}) };

    if (tierId && tier) {
      nextTiers[providerId] = tierId;
      nextCosts[providerId] = tier.cost;
    } else {
      delete nextTiers[providerId];
    }

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
    const pausedAt = existing?.pausedAt ?? new Date().toISOString().slice(0, 10);
    const next = { ...current, [providerId]: { pausedAt, resumeAt } };
    return updateUserField('providerPauses', next);
  }, [updateUserField, user?.providerPauses]);
  const resumeProvider = useCallback((providerId: number) => {
    const current = user?.providerPauses ?? {};
    if (!current[providerId]) return Promise.resolve();
    const next = { ...current };
    delete next[providerId];
    return updateUserField('providerPauses', next);
  }, [updateUserField, user?.providerPauses]);
  const updateBio = useCallback((bio: string) => updateUserField('bio', bio), [updateUserField]);

  const updateDefaultVisibility = useCallback(async (visibility: ItemVisibility) => {
    if (!uid) return;
    // Stega 1: uppdatera profil-fältet (+ legacy isPublic-mirror för bakåt-
    // kompatibilitet i rules under migrationsperioden).
    const isPublicMirror = visibility === 'public';
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
    const username = user?.username ?? null;

    // Delad läsning med buildUserExport — om nya user-owned collections
    // läggs till ska de uppdateras i collectUserDataSnapshots.
    const snaps = await collectUserDataSnapshots(id);

    const refs: DocumentReference[] = [];

    // 1. Simple per-user subcollections.
    snaps.watchlistSnap.docs.forEach(d => refs.push(d.ref));
    snaps.episodeProgressSnap.docs.forEach(d => refs.push(d.ref));
    snaps.notificationsSnap.docs.forEach(d => refs.push(d.ref));
    snaps.notInterestedSnap.docs.forEach(d => refs.push(d.ref));
    snaps.blockedSnap.docs.forEach(d => refs.push(d.ref));

    // 2. Outbound follows: delete own "following" + mirror "followers" on target.
    snaps.followingSnap.docs.forEach(d => {
      refs.push(d.ref);
      refs.push(doc(db, 'users', d.id, 'followers', id));
    });

    // 2b. Friends — radera båda hållen av relation. snaps.friendsSnap har
    // mina friend-docs (id = vännens uid). Spegla raderingen på deras sida.
    snaps.friendsSnap.docs.forEach(d => {
      refs.push(d.ref);
      refs.push(doc(db, 'users', d.id, 'friends', id));
    });
    // 2c. Pending requests (incoming + outgoing) — rensa båda hållen så
    // ingen kan accepta/cancel:a en request mot ett raderat konto.
    snaps.friendRequestsSnap.docs.forEach(d => {
      refs.push(d.ref);
      refs.push(doc(db, 'users', d.id, 'friendRequestsSent', id));
    });
    snaps.friendRequestsSentSnap.docs.forEach(d => {
      refs.push(d.ref);
      refs.push(doc(db, 'users', d.id, 'friendRequests', id));
    });

    // 3. My reviews + all their subcollections (likes + comments on my reviews).
    for (const reviewDoc of snaps.reviewsSnap.docs) {
      const [likesSnap, commentsSnap] = await Promise.all([
        getDocs(collection(db, 'reviews', reviewDoc.id, 'likes')),
        getDocs(collection(db, 'reviews', reviewDoc.id, 'comments')),
      ]);
      likesSnap.docs.forEach(d => refs.push(d.ref));
      commentsSnap.docs.forEach(d => refs.push(d.ref));
      refs.push(reviewDoc.ref);
    }

    // 4. My comments + likes on OTHERS' reviews (collection-group).
    snaps.reviewCommentsSnap.docs.forEach(d => refs.push(d.ref));
    snaps.reviewLikesSnap.docs.forEach(d => refs.push(d.ref));

    // 5. My lists + hosted Tillsammans-sessions.
    snaps.listsSnap.docs.forEach(d => refs.push(d.ref));
    snaps.sessionsSnap.docs.forEach(d => refs.push(d.ref));

    // 6. Groups: if I'm owner, delete the whole group + subcollections.
    //    If I'm a member, just remove myself from memberUids and delete my member doc.
    //    Rules update-branch forces us to keep other fields unchanged when
    //    only removing the leaving member.
    const memberLeaveUpdates: { ref: DocumentReference; newMemberUids: string[] }[] = [];
    for (const groupDoc of snaps.groupsSnap.docs) {
      const data = groupDoc.data();
      const ownerUid = data.ownerUid as string | undefined;
      if (ownerUid === id) {
        const [membersSnap, groupWatchlistSnap] = await Promise.all([
          getDocs(collection(db, 'groups', groupDoc.id, 'members')),
          getDocs(collection(db, 'groups', groupDoc.id, 'watchlist')),
        ]);
        membersSnap.docs.forEach(d => refs.push(d.ref));
        groupWatchlistSnap.docs.forEach(d => refs.push(d.ref));
        refs.push(groupDoc.ref);
      } else {
        const current = (data.memberUids as string[]) ?? [];
        memberLeaveUpdates.push({
          ref: groupDoc.ref,
          newMemberUids: current.filter(u => u !== id),
        });
        refs.push(doc(db, 'groups', groupDoc.id, 'members', id));
      }
    }

    // 9. User doc + username reservation.
    refs.push(doc(db, 'users', id));
    if (username) refs.push(doc(db, 'usernames', username));

    // Commit in ≤ 450-op chunks (Firestore limit is 500; leave headroom).
    const CHUNK = 450;
    for (let i = 0; i < refs.length; i += CHUNK) {
      const batch = writeBatch(db);
      refs.slice(i, i + CHUNK).forEach(r => batch.delete(r));
      await batch.commit();
    }
    // Member-leave updates in their own chunks (separate from deletes for clarity).
    for (let i = 0; i < memberLeaveUpdates.length; i += CHUNK) {
      const batch = writeBatch(db);
      memberLeaveUpdates.slice(i, i + CHUNK).forEach(u => {
        batch.update(u.ref, { memberUids: u.newMemberUids });
      });
      await batch.commit();
    }

    // Finally remove the Firebase Auth user.
    await deleteUser(currentUser);
  }, [user?.username]);

  const value = useMemo(
    () => ({
      user, uid, loading, emailVerified,
      signIn, signInEmail, register, resendEmailVerification, signOut,
      updateProviders, updateDefaultView, updateProviderCosts, updateProviderTier,
      pauseProvider, resumeProvider,
      updateUsername, updateBio, updateDefaultVisibility, updateIsPublic, updateHideNonLatinTitles, updateHiddenCountries,
      setCalibrationGenres, deleteAccount,
    }),
    [
      user, uid, loading, emailVerified,
      signIn, signInEmail, register, resendEmailVerification, signOut,
      updateProviders, updateDefaultView, updateProviderCosts, updateProviderTier,
      pauseProvider, resumeProvider,
      updateUsername, updateBio, updateDefaultVisibility, updateIsPublic, updateHideNonLatinTitles, updateHiddenCountries,
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
