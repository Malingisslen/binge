import { useEffect } from 'react';

// Closes a popup on Escape while it is open. Kept apart from useClickOutside because
// that hook runs for every caller whether open or not, and a global keydown listener
// should only exist while there is something to close.
export function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onEscape]);
}
