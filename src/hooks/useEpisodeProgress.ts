'use client';

import { useState, useCallback, useEffect } from 'react';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { useAuth } from '@/contexts/AuthContext';
import type { EpisodeProgress } from '@/types';

export function useEpisodeProgress(tmdbId: number) {
  const { uid } = useAuth();
  const [progress, setProgress] = useState<EpisodeProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setProgress(null); setProgressLoading(false); return; }
    setProgressLoading(true);
    return lazySubscribe(({ db, doc, onSnapshot }) =>
      onSnapshot(doc(db, 'users', uid, 'episodeProgress', String(tmdbId)), (snap) => {
        if (snap.exists()) {
          const raw = snap.data();
          // Filter out corrupted dot-notation keys (e.g. "seasons.1.5") from old bug
          if (raw.seasons && typeof raw.seasons === 'object') {
            setProgress(raw as EpisodeProgress);
          } else {
            setProgress({ tmdbId: raw.tmdbId ?? tmdbId, seasons: {} } as EpisodeProgress);
          }
        } else {
          setProgress(null);
        }
        setProgressLoading(false);
      }));
  }, [uid, tmdbId]);

  const isWatched = useCallback((season: number, episode: number): boolean => {
    return progress?.seasons?.[String(season)]?.[String(episode)]?.watched ?? false;
  }, [progress]);

  const markEpisodeWatched = useCallback(async (season: number, episode: number, watched: boolean) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'episodeProgress', String(tmdbId));
    await setDoc(ref, {
      tmdbId,
      seasons: {
        [String(season)]: {
          [String(episode)]: {
            watched,
            watchedAt: watched ? serverTimestamp() : null,
          },
        },
      },
    }, { merge: true });
  }, [uid, tmdbId]);

  const markSeasonWatched = useCallback(async (season: number, episodeCount: number) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
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

  // BIN-495: unmark a whole season in ONE Firestore write (mirrors
  // markSeasonWatched) instead of N parallel per-episode setDoc merges.
  const markSeasonUnwatched = useCallback(async (season: number, episodeNumbers: number[]) => {
    if (!uid) return;
    const { db, doc, setDoc } = await fsdb();
    const ref = doc(db, 'users', uid, 'episodeProgress', String(tmdbId));
    const seasonData: Record<string, { watched: boolean; watchedAt: unknown }> = {};
    for (const ep of episodeNumbers) {
      seasonData[String(ep)] = { watched: false, watchedAt: null };
    }
    await setDoc(ref, {
      tmdbId,
      seasons: { [String(season)]: seasonData },
    }, { merge: true });
  }, [uid, tmdbId]);

  const getSeasonProgress = useCallback((season: number, episodeCount?: number): { watched: number; total: number } => {
    const seasonData = progress?.seasons?.[String(season)];
    if (!seasonData || typeof seasonData !== 'object') return { watched: 0, total: episodeCount ?? 0 };
    const entries = Object.values(seasonData);
    return {
      watched: entries.filter(e => e && typeof e === 'object' && e.watched).length,
      total: episodeCount ?? entries.length,
    };
  }, [progress]);

  const getTotalProgress = useCallback((): number => {
    if (!progress?.seasons) return 0;
    let total = 0;
    for (const seasonData of Object.values(progress.seasons)) {
      if (seasonData && typeof seasonData === 'object') {
        for (const ep of Object.values(seasonData)) {
          if (ep && typeof ep === 'object' && ep.watched) total++;
        }
      }
    }
    return total;
  }, [progress]);

  return { progress, progressLoading, isWatched, markEpisodeWatched, markSeasonWatched, markSeasonUnwatched, getSeasonProgress, getTotalProgress };
}
