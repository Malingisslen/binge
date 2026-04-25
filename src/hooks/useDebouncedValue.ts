'use client';

import { useEffect, useState } from 'react';

/**
 * Returnerar `value` fördröjt med `delay` ms. Timern städas vid varje ny input
 * (eller vid unmount), så avbrutna keystrokes aldrig hamnar i kö.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
