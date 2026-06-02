'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Debounce a commit so rapid changes write once. The pending value is held in
 * a ref and flushed on: timer fire, explicit flush(), unmount, and pagehide/
 * visibilitychange (so collapsing the section or leaving the page never drops a
 * pending write).
 */
export function useDebouncedCommit<T>(
  commit: (value: T) => void | Promise<void>,
  delayMs: number,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const commitRef = useRef(commit);
  // Keep the ref current without writing to it during render (react-hooks/refs).
  useEffect(() => { commitRef.current = commit; });

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current) {
      const { value } = pending.current;
      pending.current = null;
      void commitRef.current(value);
    }
  }, []);

  const schedule = useCallback((value: T) => {
    pending.current = { value };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delayMs);
  }, [delayMs, flush]);

  useEffect(() => {
    const onLeave = () => flush();
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onLeave);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onLeave);
      flush(); // flush on unmount
    };
  }, [flush]);

  return { schedule, flush };
}
