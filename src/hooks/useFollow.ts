'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, doc, onSnapshot, writeBatch, serverTimestamp, getDocs } from 'firebase/firestore';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/contexts/AuthContext';

export function useFollowing() {
  const { uid } = useAuth();
  const [followingUids, setFollowingUids] = useState<string[]>([]);

  useEffect(() => {
    if (!uid) { setFollowingUids([]); return; }
    const unsub = onSnapshot(collection(db, 'users', uid, 'following'), snap => {
      setFollowingUids(snap.docs.map(d => d.id));
    });
    return () => unsub();
  }, [uid]);

  const isFollowing = useCallback((targetUid: string) => followingUids.includes(targetUid), [followingUids]);

  const followUser = useCallback(async (targetUid: string) => {
    if (!uid) return;
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid, 'following', targetUid), { followedAt: serverTimestamp() });
    batch.set(doc(db, 'users', targetUid, 'followers', uid), { followedAt: serverTimestamp() });
    await batch.commit();
  }, [uid]);

  const unfollowUser = useCallback(async (targetUid: string) => {
    if (!uid) return;
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', uid, 'following', targetUid));
    batch.delete(doc(db, 'users', targetUid, 'followers', uid));
    await batch.commit();
  }, [uid]);

  return { followingUids, isFollowing, followUser, unfollowUser };
}

export function useFollowerCount(uid: string | null) {
  return useQuery({
    queryKey: ['follower-count', uid],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'users', uid!, 'followers'));
      return snap.size;
    },
    enabled: uid !== null,
    staleTime: 60_000,
  });
}

export function useFollowingCount(uid: string | null) {
  return useQuery({
    queryKey: ['following-count', uid],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'users', uid!, 'following'));
      return snap.size;
    },
    enabled: uid !== null,
    staleTime: 60_000,
  });
}
