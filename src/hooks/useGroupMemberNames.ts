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
const NO_NAMES: Record<string, string> = {};

export function useGroupMemberNames(groupId: string | null): Record<string, string> {
  // Each snapshot is stored with the group it came from. After a switch from one group
  // to another the old group's names are still in state until the new listener fires,
  // and a caller that ticks members on arrival would otherwise tick the old group's.
  const [loaded, setLoaded] = useState<{ groupId: string; names: Record<string, string> } | null>(null);

  useEffect(() => {
    if (!groupId) return;
    return subscribeToGroupMembers(groupId, members => {
      setLoaded({ groupId, names: Object.fromEntries(members.map(m => [m.uid, m.displayName])) });
    });
  }, [groupId]);

  return groupId && loaded?.groupId === groupId ? loaded.names : NO_NAMES;
}
