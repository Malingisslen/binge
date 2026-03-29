'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/contexts/AuthContext';
import type { Review, MediaType } from '@/types';

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  return new Date();
}

export function useReviewsForTitle(tmdbId: number) {
  return useQuery({
    queryKey: ['reviews', tmdbId],
    queryFn: async () => {
      const q = query(
        collection(db, 'reviews'),
        where('tmdbId', '==', tmdbId),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          uid: data.uid,
          tmdbId: data.tmdbId,
          mediaType: data.mediaType,
          text: data.text,
          spoiler: data.spoiler ?? false,
          rating: data.rating ?? null,
          displayName: data.displayName ?? '',
          username: data.username ?? null,
          createdAt: toDate(data.createdAt),
          updatedAt: toDate(data.updatedAt),
        } as Review;
      });
    },
    staleTime: 60_000,
  });
}

export function useReviewActions() {
  const { uid, user } = useAuth();
  const queryClient = useQueryClient();

  const submitReview = async (tmdbId: number, mediaType: MediaType, text: string, spoiler: boolean, rating: number | null, existingId?: string) => {
    if (!uid || !user) return;
    const reviewData = {
      uid,
      tmdbId,
      mediaType,
      text,
      spoiler,
      rating,
      displayName: user.displayName,
      username: user.username,
      updatedAt: serverTimestamp(),
    };
    if (existingId) {
      await updateDoc(doc(db, 'reviews', existingId), reviewData);
    } else {
      await addDoc(collection(db, 'reviews'), { ...reviewData, createdAt: serverTimestamp() });
    }
    queryClient.invalidateQueries({ queryKey: ['reviews', tmdbId] });
  };

  const deleteReview = async (reviewId: string, tmdbId: number) => {
    await deleteDoc(doc(db, 'reviews', reviewId));
    queryClient.invalidateQueries({ queryKey: ['reviews', tmdbId] });
  };

  return { submitReview, deleteReview };
}
