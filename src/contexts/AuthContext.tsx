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
import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  collectionGroup,
  documentId,
  query,
  where,
  writeBatch,
  serverTimestamp,
  type DocumentReference,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/config';
import type { UserProfile } from '@/types';

interface AuthState {
  user: UserProfile | null;
  uid: string | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, termsVersion: string) => Promise<void>;
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
      termsAcceptedAt: data.termsAcceptedAt?.toDate(),
      termsVersion: data.termsVersion as string | undefined,
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
    const username = user?.username ?? null;

    // Collect everything owned by the user across all collections.
    // Some queries (collectionGroup with documentId/where) rely on
    // single-field collection-group indexes — added to firestore.indexes.json.
    const [
      watchlistSnap,
      progressSnap,
      notifSnap,
      followingSnap,
      myReviewsSnap,
      myListsSnap,
      mySessionsSnap,
      myGroupsSnap,
      myCommentsSnap,
      myLikesSnap,
    ] = await Promise.all([
      getDocs(collection(db, 'users', id, 'watchlist')),
      getDocs(collection(db, 'users', id, 'episodeProgress')),
      getDocs(collection(db, 'users', id, 'notifications')),
      getDocs(collection(db, 'users', id, 'following')),
      getDocs(query(collection(db, 'reviews'), where('uid', '==', id))),
      getDocs(query(collection(db, 'lists'), where('uid', '==', id))),
      getDocs(query(collection(db, 'sessions'), where('hostUid', '==', id))),
      getDocs(query(collection(db, 'groups'), where('memberUids', 'array-contains', id))),
      // My comments on OTHERS' reviews (own-review comments handled below).
      getDocs(query(collectionGroup(db, 'comments'), where('uid', '==', id))),
      // My likes on reviews — doc id is my uid.
      getDocs(query(collectionGroup(db, 'likes'), where(documentId(), '==', id))),
    ]);

    const refs: DocumentReference[] = [];

    // 1. Simple per-user subcollections.
    watchlistSnap.docs.forEach(d => refs.push(d.ref));
    progressSnap.docs.forEach(d => refs.push(d.ref));
    notifSnap.docs.forEach(d => refs.push(d.ref));

    // 2. Outbound follows: delete own "following" + mirror "followers" on target.
    followingSnap.docs.forEach(d => {
      refs.push(d.ref);
      refs.push(doc(db, 'users', d.id, 'followers', id));
    });

    // 3. My reviews + all their subcollections (likes + comments on my reviews).
    for (const reviewDoc of myReviewsSnap.docs) {
      const [likesSnap, commentsSnap] = await Promise.all([
        getDocs(collection(db, 'reviews', reviewDoc.id, 'likes')),
        getDocs(collection(db, 'reviews', reviewDoc.id, 'comments')),
      ]);
      likesSnap.docs.forEach(d => refs.push(d.ref));
      commentsSnap.docs.forEach(d => refs.push(d.ref));
      refs.push(reviewDoc.ref);
    }

    // 4. My comments on OTHERS' reviews (collection-group).
    myCommentsSnap.docs.forEach(d => refs.push(d.ref));

    // 5. My likes on OTHERS' reviews (collection-group by documentId == uid).
    myLikesSnap.docs.forEach(d => refs.push(d.ref));

    // 6. My lists.
    myListsSnap.docs.forEach(d => refs.push(d.ref));

    // 7. Sessions I host (Tillsammans).
    mySessionsSnap.docs.forEach(d => refs.push(d.ref));

    // 8. Groups: if I'm owner, delete the whole group + subcollections.
    //    If I'm a member, just remove myself from memberUids and delete my member doc.
    //    Rules update-branch forces us to keep other fields unchanged when
    //    only removing the leaving member.
    const memberLeaveUpdates: { ref: DocumentReference; newMemberUids: string[] }[] = [];
    for (const groupDoc of myGroupsSnap.docs) {
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
