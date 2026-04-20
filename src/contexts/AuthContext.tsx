'use client';

import { createContext, useContext, useMemo, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as firebaseSignOut,
  deleteUser,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, getDocs, collection, writeBatch, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/config';
import type { UserProfile } from '@/types';

interface AuthState {
  user: UserProfile | null;
  uid: string | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProviders: (providers: number[]) => Promise<void>;
  updateDefaultView: (view: 'table' | 'grid') => Promise<void>;
  updateProviderCosts: (costs: Record<number, number>) => Promise<void>;
  updateProviderTier: (providerId: number, tierId: string | null) => Promise<void>;
  pauseProvider: (providerId: number, resumeAt?: string | null) => Promise<void>;
  resumeProvider: (providerId: number) => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
  updateBio: (bio: string) => Promise<void>;
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
  signIn: async () => {},
  signInEmail: async () => {},
  register: async () => {},
  signOut: async () => {},
  updateProviders: async () => {},
  updateDefaultView: async () => {},
  updateProviderCosts: async () => {},
  updateProviderTier: async () => {},
  pauseProvider: async () => {},
  resumeProvider: async () => {},
  updateUsername: async () => {},
  updateBio: async () => {},
  updateIsPublic: async () => {},
  updateHideNonLatinTitles: async () => {},
  updateHiddenCountries: async () => {},
  setCalibrationGenres: async () => {},
  deleteAccount: async () => {},
});

async function ensureUserProfile(firebaseUser: User): Promise<UserProfile> {
  const ref = doc(db, 'users', firebaseUser.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data();
    return {
      displayName: data.displayName ?? firebaseUser.displayName ?? '',
      email: data.email ?? firebaseUser.email ?? '',
      photoURL: data.photoURL ?? firebaseUser.photoURL,
      username: (data.username as string) ?? null,
      bio: (data.bio as string) ?? '',
      isPublic: (data.isPublic as boolean) ?? false,
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
      notificationSettings: data.notificationSettings ?? {
        newEpisodes: true,
        availableOnMyServices: true,
      },
    };
  }

  const profile: UserProfile = {
    displayName: firebaseUser.displayName ?? '',
    email: firebaseUser.email ?? '',
    photoURL: firebaseUser.photoURL,
    username: null,
    bio: '',
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

  return profile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const profile = await ensureUserProfile(firebaseUser);
          setUser(profile);
          setUid(firebaseUser.uid);
        } catch (err) {
          console.error('Failed to load user profile:', err);
          setUser(null);
          setUid(null);
        }
      } else {
        setUser(null);
        setUid(null);
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

  const register = useCallback(async (email: string, password: string, name: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
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
  const updateIsPublic = useCallback((isPublic: boolean) => updateUserField('isPublic', isPublic), [updateUserField]);
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
    const batch = writeBatch(db);
    const [watchlistSnap, progressSnap, notifSnap] = await Promise.all([
      getDocs(collection(db, 'users', id, 'watchlist')),
      getDocs(collection(db, 'users', id, 'episodeProgress')),
      getDocs(collection(db, 'users', id, 'notifications')),
    ]);
    watchlistSnap.docs.forEach(d => batch.delete(d.ref));
    progressSnap.docs.forEach(d => batch.delete(d.ref));
    notifSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, 'users', id));
    if (user?.username) batch.delete(doc(db, 'usernames', user.username));
    await batch.commit();
    await deleteUser(currentUser);
    // NOTE: cascade is still incomplete per 02 G-3 / 11 LC-1 — reviews,
    // comments, lists, follower records, and group memberships are not
    // yet deleted. Tracked for Sprint 1 Day 8 (4.1).
  }, [user?.username]);

  const value = useMemo(
    () => ({
      user, uid, loading,
      signIn, signInEmail, register, signOut,
      updateProviders, updateDefaultView, updateProviderCosts, updateProviderTier,
      pauseProvider, resumeProvider,
      updateUsername, updateBio, updateIsPublic, updateHideNonLatinTitles, updateHiddenCountries,
      setCalibrationGenres, deleteAccount,
    }),
    [
      user, uid, loading,
      signIn, signInEmail, register, signOut,
      updateProviders, updateDefaultView, updateProviderCosts, updateProviderTier,
      pauseProvider, resumeProvider,
      updateUsername, updateBio, updateIsPublic, updateHideNonLatinTitles, updateHiddenCountries,
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
