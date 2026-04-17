'use client';

import { useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  addDoc,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/hooks/useAuth';
import type { ReviewComment } from '@/types';

export function useReviewLikes(reviewId: string | null) {
  const { uid } = useAuth();
  const [likeCount, setLikeCount] = useState(0);
  const [iLike, setILike] = useState(false);

  useEffect(() => {
    if (!reviewId) return;
    const unsub = onSnapshot(collection(db, 'reviews', reviewId, 'likes'), snap => {
      setLikeCount(snap.size);
      setILike(uid ? snap.docs.some(d => d.id === uid) : false);
    });
    return () => unsub();
  }, [reviewId, uid]);

  const toggle = async () => {
    if (!reviewId || !uid) return;
    const ref = doc(db, 'reviews', reviewId, 'likes', uid);
    if (iLike) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { createdAt: serverTimestamp() });
    }
  };

  return { likeCount, iLike, toggle };
}

export function useReviewComments(reviewId: string | null) {
  const { uid, user } = useAuth();
  const [comments, setComments] = useState<ReviewComment[]>([]);

  useEffect(() => {
    if (!reviewId) return;
    const q = query(
      collection(db, 'reviews', reviewId, 'comments'),
      orderBy('createdAt', 'asc'),
    );
    const unsub = onSnapshot(q, snap => {
      setComments(snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          uid: data.uid as string,
          text: data.text as string,
          displayName: (data.displayName as string) ?? '',
          username: (data.username as string | null) ?? null,
          createdAt: toDate(data.createdAt),
        };
      }));
    });
    return () => unsub();
  }, [reviewId]);

  const addComment = async (text: string) => {
    if (!reviewId || !uid || !user) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    await addDoc(collection(db, 'reviews', reviewId, 'comments'), {
      uid,
      text: trimmed,
      displayName: user.displayName,
      username: user.username,
      createdAt: serverTimestamp(),
    });
  };

  const deleteComment = async (commentId: string) => {
    if (!reviewId) return;
    await deleteDoc(doc(db, 'reviews', reviewId, 'comments', commentId));
  };

  return { comments, addComment, deleteComment };
}
