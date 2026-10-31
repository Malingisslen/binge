'use client';

import { useEffect, useState } from 'react';
import { subscribeToGroupMembers } from '@/lib/firebase/groups';

/**
 * uid → displayName for a group's members, read from members/{uid} (the same
 * subscription useGroup uses). Household votes show names, but the contribution
 * stores none: a name changed or removed in the member doc is never stale elsewhere.
 * Separate from useGroup because that hook also opens the group's watchlist listener,
 * which the household view has no use for.
 */
export function useGroupMemberNames(groupId: string | null): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!groupId) { setNames({}); return; }
    return subscribeToGroupMembers(groupId, members => {
      setNames(Object.fromEntries(members.map(m => [m.uid, m.displayName])));
    });
  }, [groupId]);

  return names;
}
