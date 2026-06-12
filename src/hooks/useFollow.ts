'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { useAuth } from '@/contexts/AuthContext';

// Högsta antal följda vi läser för att beräkna is-following-relationer klient-
// sidan. Power users med 500+ följda får en paginerad view i framtiden (se 9.4
// TODO). 500 räcker långt för normalanvändning och skyddar mot read-bombs.
const FOLLOWING_LIMIT = 500;

export function useFollowing() {
  const { uid } = useAuth();
  const [followingUids, setFollowingUids] = useState<string[]>([]);

  useEffect(() => {
    if (!uid) { setFollowingUids([]); return; }
    return lazySubscribe(({ db, collection, query, limit, onSnapshot }) =>
      onSnapshot(query(collection(db, 'users', uid, 'following'), limit(FOLLOWING_LIMIT)), snap => {
        setFollowingUids(snap.docs.map(d => d.id));
      }));
  }, [uid]);

  const isFollowing = useCallback((targetUid: string) => followingUids.includes(targetUid), [followingUids]);

  const followUser = useCallback(async (targetUid: string) => {
    if (!uid) return;
    const { db, doc, writeBatch, serverTimestamp } = await fsdb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid, 'following', targetUid), { followedAt: serverTimestamp() });
    batch.set(doc(db, 'users', targetUid, 'followers', uid), { followedAt: serverTimestamp() });
    await batch.commit();
  }, [uid]);

  const unfollowUser = useCallback(async (targetUid: string) => {
    if (!uid) return;
    const { db, doc, writeBatch } = await fsdb();
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', uid, 'following', targetUid));
    batch.delete(doc(db, 'users', targetUid, 'followers', uid));
    await batch.commit();
  }, [uid]);

  return { followingUids, isFollowing, followUser, unfollowUser };
}

// Använder getCountFromServer() istället för att läsa hela subcollectionen bara
// för att räkna — aggregate-queries kostar 1 read oavsett collection-storlek.
// Tidigare implementation gjorde N reads för N följare (skalade dåligt).
export function useFollowerCount(uid: string | null) {
  return useQuery({
    queryKey: ['follower-count', uid],
    queryFn: async () => {
      const { db, collection, getCountFromServer } = await fsdb();
      const snap = await getCountFromServer(collection(db, 'users', uid!, 'followers'));
      return snap.data().count;
    },
    enabled: uid !== null,
    staleTime: 60_000,
  });
}

export function useFollowingCount(uid: string | null) {
  return useQuery({
    queryKey: ['following-count', uid],
    queryFn: async () => {
      const { db, collection, getCountFromServer } = await fsdb();
      const snap = await getCountFromServer(collection(db, 'users', uid!, 'following'));
      return snap.data().count;
    },
    enabled: uid !== null,
    staleTime: 60_000,
  });
}
