'use client';

import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/contexts/AuthContext';

// Topp-cap för hur många UIDs vi materialiserar i klienten samtidigt. Matchar
// FOLLOWING_LIMIT i useFollow.ts. Power-users med >500 följda får paginering
// senare; tills dess sätter vi ett synligt tak.
const FOLLOW_LIST_LIMIT = 500;

export interface FollowListUser {
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  isPublic: boolean;
}

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

  useEffect(() => {
    if (!uid) { setFollowingUids([]); setFollowerUids([]); return; }
    const followingQ = query(collection(db, 'users', uid, 'following'), limit(FOLLOW_LIST_LIMIT));
    const followersQ = query(collection(db, 'users', uid, 'followers'), limit(FOLLOW_LIST_LIMIT));
    const unsub1 = onSnapshot(followingQ, snap => setFollowingUids(snap.docs.map(d => d.id)));
    const unsub2 = onSnapshot(followersQ, snap => setFollowerUids(snap.docs.map(d => d.id)));
    return () => { unsub1(); unsub2(); };
  }, [uid]);

  useEffect(() => {
    let cancelled = false;
    setProfilesLoading(true);
    const allUids = Array.from(new Set([...followingUids, ...followerUids]));
    if (allUids.length === 0) {
      setFollowing([]);
      setFollowers([]);
      setProfilesLoading(false);
      return;
    }

    Promise.all(allUids.map(async u => {
      try {
        const snap = await getDoc(doc(db, 'users', u));
        if (!snap.exists()) return [u, null] as const;
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
      const map = new Map(entries.map(([u, p]) => [u, p]));
      const fallback = (u: string): FollowListUser => ({
        uid: u, displayName: 'Privat användare', username: null, photoURL: null, isPublic: false,
      });
      setFollowing(followingUids.map(u => map.get(u) ?? fallback(u)));
      setFollowers(followerUids.map(u => map.get(u) ?? fallback(u)));
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
