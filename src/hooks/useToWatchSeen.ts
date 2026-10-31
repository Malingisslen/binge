'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { parseSeen } from '@/lib/toWatchSeen';

const CHANGED = 'binge:toWatchSeenChanged';
const EMPTY = '[]';

/**
 * Titles already shown on "Nytt för dig", kept per account in this browser. It stays out of
 * Firestore on purpose: a read-marker is not worth a write on every visit, and the cost is only
 * that a second device starts its counter from zero.
 */
export function useToWatchSeen(): { seen: ReadonlySet<string>; markSeen: (keys: readonly string[]) => void } {
  const { uid } = useAuth();
  const storageKey = uid ? `binge:toWatchSeen:${uid}` : null;

  const raw = useSyncExternalStore(
    useCallback((cb: () => void) => {
      window.addEventListener(CHANGED, cb);
      window.addEventListener('storage', cb);
      return () => {
        window.removeEventListener(CHANGED, cb);
        window.removeEventListener('storage', cb);
      };
    }, []),
    () => {
      if (!storageKey) return EMPTY;
      try { return window.localStorage.getItem(storageKey) ?? EMPTY; } catch { return EMPTY; }
    },
    () => EMPTY,
  );
  const seen = useMemo(() => parseSeen(raw), [raw]);

  const markSeen = useCallback((keys: readonly string[]) => {
    if (!storageKey) return;
    try {
      const current = parseSeen(window.localStorage.getItem(storageKey));
      if (keys.every(k => current.has(k))) return;
      keys.forEach(k => current.add(k));
      window.localStorage.setItem(storageKey, JSON.stringify([...current]));
      window.dispatchEvent(new Event(CHANGED));
    } catch {
      // Blocked storage only means the counter keeps its number.
    }
  }, [storageKey]);

  return { seen, markSeen };
}

/** Marks the given titles as seen once the page has settled on them. */
export function useMarkToWatchSeen(keys: readonly string[], ready: boolean): void {
  const { markSeen } = useToWatchSeen();
  const joined = keys.join('|');
  useEffect(() => {
    if (ready) markSeen(joined ? joined.split('|') : []);
  }, [ready, joined, markSeen]);
}
