'use client';

import { useEffect, useRef, useState } from 'react';
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
  limit,
  getCountFromServer,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/hooks/useAuth';
import type { ReviewComment } from '@/types';

export function useReviewLikes(reviewId: string | null) {
  const { uid } = useAuth();
  const [likeCount, setLikeCount] = useState(0);
  const [iLike, setILike] = useState(false);
  // Skydd mot dubbelräkning vid snabba dubbelklick — släpp inte in en ny
  // toggle förrän den föregående skrivningen är klar.
  const inFlight = useRef(false);

  // Likes skalar med review-popularitet — en viral recension kan få tusentals.
  // Vi lyssnar bara på inloggad användares eget like-dokument för iLike-state,
  // och hämtar antal via aggregate-count. Tidigare implementation läste hela
  // likes-collectionen bara för att räkna (N reads för N likes).
  useEffect(() => {
    if (!reviewId) { setLikeCount(0); setILike(false); return; }

    // Hämta likeCount en gång vid mount — uppdateras vid toggle via optimism.
    let cancelled = false;
    getCountFromServer(collection(db, 'reviews', reviewId, 'likes'))
      .then(snap => { if (!cancelled) setLikeCount(snap.data().count); })
      .catch(() => { if (!cancelled) setLikeCount(0); });

    if (!uid) { return () => { cancelled = true; }; }
    // Lyssna bara på mitt eget like-dokument — 1 read istället för N.
    const myLikeRef = doc(db, 'reviews', reviewId, 'likes', uid);
    const unsub = onSnapshot(myLikeRef, snap => {
      setILike(snap.exists());
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [reviewId, uid]);

  const toggle = async () => {
    if (!reviewId || !uid) return;
    // Ignorera nya klick medan en skrivning pågår — annars dubbelräknas
    // likeCount vid snabba dubbelklick.
    if (inFlight.current) return;
    inFlight.current = true;
    const ref = doc(db, 'reviews', reviewId, 'likes', uid);
    const wasLiked = iLike;
    // Sätt iLike + likeCount optimistiskt direkt så UI:t inte hoppar och
    // så snabba klick speglar rätt nästa-state innan onSnapshot hinner ikapp.
    setILike(!wasLiked);
    setLikeCount(c => (wasLiked ? Math.max(0, c - 1) : c + 1));
    try {
      if (wasLiked) {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, { createdAt: serverTimestamp() });
      }
    } catch {
      // Rulla tillbaka optimismen om skrivningen misslyckas.
      setILike(wasLiked);
      setLikeCount(c => (wasLiked ? c + 1 : Math.max(0, c - 1)));
    } finally {
      inFlight.current = false;
    }
  };

  return { likeCount, iLike, toggle };
}

export function useReviewComments(reviewId: string | null) {
  const { uid, user } = useAuth();
  const [comments, setComments] = useState<ReviewComment[]>([]);

  useEffect(() => {
    if (!reviewId) return;
    // Begränsa antalet kommentarer vi prenumererar på. Populära recensioner
    // kan få hundratals kommentarer — vi visar de senaste 100 och lägger
    // till paginering när det blir aktuellt (TODO: useInfiniteQuery).
    const q = query(
      collection(db, 'reviews', reviewId, 'comments'),
      orderBy('createdAt', 'asc'),
      limit(100),
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
