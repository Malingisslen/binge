'use client';

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

/**
 * useState that survives a reload through localStorage. The stored value is read
 * after mount, so the prerendered HTML and the first client render agree; anything
 * unreadable (private mode, blocked storage, an old shape) falls back via sanitize.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
  sanitize: (raw: unknown) => T,
): [T, (next: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(initial);
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    let stored: T = initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) stored = sanitize(JSON.parse(raw));
    } catch {
      // Unreadable storage keeps the default.
    }
    loadedKey.current = key;
    setValue(stored);
    // initial and sanitize are fixed per call site; re-reading on their identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback((next: SetStateAction<T>) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      if (loadedKey.current === key) {
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // A full or blocked storage only costs persistence, not the filter.
        }
      }
      return resolved;
    });
  }, [key]);

  return [value, set];
}
