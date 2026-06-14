'use client';

import { useEffect, useRef, useState } from 'react';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { useAuth } from '@/contexts/AuthContext';
import { type FollowListUser, type FollowProfile, resolveFollowRows } from './useFollowList.helpers';

export type { FollowListUser } from './useFollowList.helpers';

// Topp-cap för hur många UIDs vi materialiserar i klienten samtidigt. Matchar
// FOLLOWING_LIMIT i useFollow.ts. Power-users med >500 följda får paginering
// senare; tills dess sätter vi ett synligt tak.
const FOLLOW_LIST_LIMIT = 500;

interface FollowListState {
  following: FollowListUser[];
  followers: FollowListUser[];
  isLoading: boolean;
}

// Komponerad hook som ger både följer-listan och följare-listan tillsammans
// med profil-metadata (displayName, photoURL, username). Båda subkollektioner
// streamas via onSnapshot så listan uppdateras live när användaren följer/
// avföljer någon.
//
// Profil-fetchen är best-effort: icke-publika profiler ger permission-denied
// från Firestore-regeln och hamnar som "okänd användare" istället för att
// trigga felflöde — vi visar fortfarande raden men utan namn/avatar.
export function useFollowList(): FollowListState {
  const { uid } = useAuth();
  const [followingUids, setFollowingUids] = useState<string[]>([]);
  const [followerUids, setFollowerUids] = useState<string[]>([]);
  const [following, setFollowing] = useState<FollowListUser[]>([]);
  const [followers, setFollowers] = useState<FollowListUser[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  // Cache per uid → profil (FollowListUser), null (privat/fetch-fel) eller
  // 'ghost' (profil-doc saknas = raderat konto). Gör att vi bara hämtar NYA
  // uids när follow-listan ändras, istället för att refetcha alla upp till
  // 1000 profiler vid varje följ/avfölj (H5).
  const profileCache = useRef<Map<string, FollowProfile>>(new Map());

  useEffect(() => {
    if (!uid) { setFollowingUids([]); setFollowerUids([]); return; }
    const unsub1 = lazySubscribe(({ db, collection, query, limit, onSnapshot }) =>
      onSnapshot(query(collection(db, 'users', uid, 'following'), limit(FOLLOW_LIST_LIMIT)),
        snap => setFollowingUids(snap.docs.map(d => d.id))));
    const unsub2 = lazySubscribe(({ db, collection, query, limit, onSnapshot }) =>
      onSnapshot(query(collection(db, 'users', uid, 'followers'), limit(FOLLOW_LIST_LIMIT)),
        snap => setFollowerUids(snap.docs.map(d => d.id))));
    return () => { unsub1(); unsub2(); };
  }, [uid]);

  useEffect(() => {
    let cancelled = false;
    const cache = profileCache.current;
    const allUids = Array.from(new Set([...followingUids, ...followerUids]));
    if (allUids.length === 0) {
      setFollowing([]);
      setFollowers([]);
      setProfilesLoading(false);
      return;
    }

    const build = () => {
      setFollowing(resolveFollowRows(followingUids, cache));
      setFollowers(resolveFollowRows(followerUids, cache));
    };

    // Hämta bara uids vi inte redan har i cachen.
    const missing = allUids.filter(u => !cache.has(u));
    if (missing.length === 0) {
      build();
      setProfilesLoading(false);
      return;
    }

    setProfilesLoading(true);
    Promise.all(missing.map(async u => {
      try {
        const { db, doc, getDoc } = await fsdb();
        const snap = await getDoc(doc(db, 'users', u));
        // Profil-doc saknas = raderat konto (tombstone). Markera 'ghost' så
        // resolveFollowRows filtrerar bort den dangling följ-referensen i
        // stället för att visa den som "Privat användare" (BIN-21).
        if (!snap.exists()) return [u, 'ghost'] as const;
        const d = snap.data();
        return [u, {
          uid: u,
          displayName: (d.displayName as string) ?? 'Okänd',
          username: (d.username as string | null) ?? null,
          photoURL: (d.photoURL as string | null) ?? null,
          isPublic: (d.isPublic as boolean) ?? false,
        }] as const;
      } catch {
        return [u, null] as const;
      }
    })).then(entries => {
      if (cancelled) return;
      for (const [u, p] of entries) cache.set(u, p);
      build();
      setProfilesLoading(false);
    });

    return () => { cancelled = true; };
  }, [followingUids, followerUids]);

  return {
    following,
    followers,
    isLoading: profilesLoading,
  };
}
