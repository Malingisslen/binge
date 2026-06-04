'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, limit, startAfter, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/contexts/AuthContext';
import type { Review, MediaType } from '@/types';

// Sidstorlek för recensioner per titel. Paginering via useInfiniteQuery +
// Firestore startAfter-cursor på createdAt — "Visa fler" hämtar nästa sida.
const REVIEWS_PAGE_SIZE = 20;

interface ReviewsPage {
  reviews: Review[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  full: boolean;
}

function mapReviewDoc(d: QueryDocumentSnapshot<DocumentData>): Review {
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
}

export function useReviewsForTitle(tmdbId: number) {
  return useInfiniteQuery({
    queryKey: ['reviews', tmdbId],
    initialPageParam: null as QueryDocumentSnapshot<DocumentData> | null,
    queryFn: async ({ pageParam }): Promise<ReviewsPage> => {
      const q = query(
        collection(db, 'reviews'),
        where('tmdbId', '==', tmdbId),
        orderBy('createdAt', 'desc'),
        ...(pageParam ? [startAfter(pageParam)] : []),
        limit(REVIEWS_PAGE_SIZE),
      );
      const snap = await getDocs(q);
      return {
        reviews: snap.docs.map(mapReviewDoc),
        cursor: snap.docs.length === REVIEWS_PAGE_SIZE ? snap.docs[snap.docs.length - 1] : null,
        full: snap.docs.length === REVIEWS_PAGE_SIZE,
      };
    },
    getNextPageParam: (last) => (last.full ? last.cursor : undefined),
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
