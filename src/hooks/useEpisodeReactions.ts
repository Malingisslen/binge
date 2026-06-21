'use client';

import { useState, useEffect, useCallback } from 'react';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/contexts/AuthContext';

// BIN-95: per-episode reaction threads. Keyed episodeReactions/{tmdbId_s_e}/
// reactions/{id} (mirrors reviews). Subscribed only when the consumer opts in
// (the thread is expanded AND the viewer has watched the episode) so we don't
// fan out a listener per episode row.
export interface EpisodeReaction {
  id: string;
  uid: string;
  text: string;
  spoiler: boolean;
  displayName: string | null;
  username: string | null;
  createdAt: Date;
}

export function episodeReactionKey(tmdbId: number, season: number, episode: number): string {
  return `${tmdbId}_${season}_${episode}`;
}

export function useEpisodeReactions(tmdbId: number, season: number, episode: number, enabled: boolean) {
  const { uid, user } = useAuth();
  const [reactions, setReactions] = useState<EpisodeReaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) { setReactions([]); setLoading(false); return; }
    setLoading(true);
    const key = episodeReactionKey(tmdbId, season, episode);
    return lazySubscribe(({ db, collection, query, orderBy, limit, onSnapshot }) =>
      onSnapshot(query(
        collection(db, 'episodeReactions', key, 'reactions'),
        orderBy('createdAt', 'desc'),
        limit(50),
      ), snap => {
        setReactions(snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            uid: data.uid as string,
            text: data.text as string,
            spoiler: (data.spoiler as boolean) ?? false,
            displayName: (data.displayName as string) ?? null,
            username: (data.username as string) ?? null,
            createdAt: toDate(data.createdAt),
          };
        }));
        setLoading(false);
      }));
  }, [enabled, tmdbId, season, episode]);

  const addReaction = useCallback(async (text: string, spoiler: boolean): Promise<{ ok: boolean; error?: string }> => {
    if (!uid) return { ok: false, error: 'Logga in för att reagera.' };
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: 'Skriv något först.' };
    try {
      const { db, collection, addDoc, serverTimestamp } = await fsdb();
      await addDoc(collection(db, 'episodeReactions', episodeReactionKey(tmdbId, season, episode), 'reactions'), {
        uid, tmdbId, mediaType: 'tv', seasonNumber: season, episodeNumber: episode,
        text: trimmed.slice(0, 2000), spoiler,
        displayName: user?.displayName ?? null,
        username: user?.username ?? null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Kunde inte spara reaktionen.' };
    }
    // `user` (whole object) matches the React Compiler's inferred dep — listing
    // user?.displayName/username instead trips "memoization could not be preserved".
  }, [uid, user, tmdbId, season, episode]);

  const deleteReaction = useCallback(async (id: string) => {
    if (!uid) return;
    const { db, doc, deleteDoc } = await fsdb();
    await deleteDoc(doc(db, 'episodeReactions', episodeReactionKey(tmdbId, season, episode), 'reactions', id));
  }, [uid, tmdbId, season, episode]);

  return { reactions, loading, addReaction, deleteReaction, currentUid: uid };
}
