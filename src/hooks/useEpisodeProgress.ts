'use client';

import { useState, useCallback, useEffect } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/contexts/AuthContext';
import type { EpisodeProgress } from '@/types';

export function useEpisodeProgress(tmdbId: number) {
  const { uid } = useAuth();
  const [progress, setProgress] = useState<EpisodeProgress | null>(null);

  useEffect(() => {
    if (!uid) { setProgress(null); return; }
    const ref = doc(db, 'users', uid, 'episodeProgress', String(tmdbId));
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setProgress(snap.data() as EpisodeProgress);
      } else {
        setProgress(null);
      }
    });
    return () => unsub();
  }, [uid, tmdbId]);

  const isWatched = useCallback((season: number, episode: number): boolean => {
    return progress?.seasons[String(season)]?.[String(episode)]?.watched ?? false;
  }, [progress]);

  const markEpisodeWatched = useCallback(async (season: number, episode: number, watched: boolean) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'episodeProgress', String(tmdbId));
    await setDoc(ref, {
      tmdbId,
      [`seasons.${season}.${episode}`]: {
        watched,
        watchedAt: watched ? serverTimestamp() : null,
      },
    }, { merge: true });
  }, [uid, tmdbId]);

  const markSeasonWatched = useCallback(async (season: number, episodeCount: number) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'episodeProgress', String(tmdbId));
    const seasonData: Record<string, { watched: boolean; watchedAt: unknown }> = {};
    for (let i = 1; i <= episodeCount; i++) {
      seasonData[String(i)] = { watched: true, watchedAt: serverTimestamp() };
    }
    await setDoc(ref, {
      tmdbId,
      seasons: { [String(season)]: seasonData },
    }, { merge: true });
  }, [uid, tmdbId]);

  const getSeasonProgress = useCallback((season: number): { watched: number; total: number } => {
    const seasonData = progress?.seasons[String(season)];
    if (!seasonData) return { watched: 0, total: 0 };
    const entries = Object.values(seasonData);
    return {
      watched: entries.filter(e => e.watched).length,
      total: entries.length,
    };
  }, [progress]);

  return { progress, isWatched, markEpisodeWatched, markSeasonWatched, getSeasonProgress };
}
