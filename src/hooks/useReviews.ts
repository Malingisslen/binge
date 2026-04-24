'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/contexts/AuthContext';
import type { Review, MediaType } from '@/types';

// Max antal recensioner vi visar per titel. Väl över "relevanta första
// vyn"-tröskeln; populära filmer kan ha hundratals recensioner men ingen
// läser längre ner än 50 utan paginering. När vi bygger paginering (TODO:
// useInfiniteQuery + cursor på createdAt) höjer vi gränsen.
const REVIEWS_PER_TITLE_LIMIT = 50;

export function useReviewsForTitle(tmdbId: number) {
  return useQuery({
    queryKey: ['reviews', tmdbId],
    queryFn: async () => {
      const q = query(
        collection(db, 'reviews'),
        where('tmdbId', '==', tmdbId),
        orderBy('createdAt', 'desc'),
        limit(REVIEWS_PER_TITLE_LIMIT),
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

  const submitReview = async (
    tmdbId: number,
    mediaType: MediaType,
    text: string,
    spoiler: boolean,
    rating: number | null,
    existingId?: string,
    titleMeta?: { title: string; posterPath: string | null },
  ) => {
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
      ...(titleMeta ? { title: titleMeta.title, posterPath: titleMeta.posterPath } : {}),
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
