'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

// A shared device must not show the next person what the previous one looked
// up. Watches the sign-in → signed-out transition (not "signed out" itself) so a
// guest who never signed in keeps their own history. Covers every cause of
// sign-out, including an expired session and a deletion, and every open tab.
export function useClearRecentSearchesOnSignOut(uid: string | null) {
  const hadSession = useRef(false);
  useEffect(() => {
    if (uid) {
      hadSession.current = true;
    } else if (hadSession.current) {
      hadSession.current = false;
      clearRecentSearches();
    }
  }, [uid]);
}
