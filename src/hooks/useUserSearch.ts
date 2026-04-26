'use client';

import { useQuery } from '@tanstack/react-query';
import { searchUsersByPrefix } from '@/lib/firebase/userSearch';

// Användarsökning för SearchDropdown. Kort staleTime (60 s) eftersom
// claim/release av usernames är sällsynt men inte oföränderligt; gcTime
// 5 min för att hålla träffar varma vid snabb omtypning.
export function useUserSearch(prefix: string) {
  return useQuery({
    queryKey: ['user-search', prefix.trim().toLowerCase().replace(/^@/, '')],
    queryFn: () => searchUsersByPrefix(prefix),
    enabled: prefix.trim().length >= 2,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}
