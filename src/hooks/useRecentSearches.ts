'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  clearRecentSearches,
  readRecentSearches,
  removeRecentSearch,
  RECENT_SEARCHES_EVENT,
} from '@/lib/recentSearches';

// Read after mount, not during render, so the static export and the first client
// render match.
export function useRecentSearches() {
  const [searches, setSearches] = useState<string[]>([]);

  const refresh = useCallback(() => setSearches(readRecentSearches()), []);

  useEffect(() => {
    refresh();
    window.addEventListener(RECENT_SEARCHES_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(RECENT_SEARCHES_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  return { searches, remove: removeRecentSearch, clear: clearRecentSearches };
}
