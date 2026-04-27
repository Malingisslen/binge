'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { searchUsersByPrefix } from '@/lib/firebase/userSearch';

// Användarsökning för SearchDropdown. Kort staleTime (60 s) eftersom
// claim/release av usernames är sällsynt men inte oföränderligt; gcTime
// 5 min för att hålla träffar varma vid snabb omtypning.
//
// myUid passas så icke-public-konton som ändå är mina vänner kommer med
// (sökresultaten visar dem trots tier-filtret).
export function useUserSearch(prefix: string) {
  const { uid } = useAuth();
  return useQuery({
    queryKey: ['user-search', prefix.trim().toLowerCase().replace(/^@/, ''), uid],
    queryFn: () => searchUsersByPrefix(prefix, uid),
    enabled: prefix.trim().length >= 2,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}
