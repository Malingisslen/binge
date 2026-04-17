'use client';

import { useEffect, useState } from 'react';
import {
  subscribeToMyGroups,
  subscribeToGroup,
  subscribeToGroupMembers,
  subscribeToGroupWatchlist,
} from '@/lib/firebase/groups';
import type { Group, GroupMember, GroupWatchlistItem } from '@/types';

export function useMyGroups(uid: string | null) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setGroups([]); setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToMyGroups(uid, gs => {
      setGroups(gs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
      setLoading(false);
    });
    return () => unsub();
  }, [uid]);

  return { groups, loading };
}

export function useGroup(groupId: string | null) {
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [watchlist, setWatchlist] = useState<GroupWatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!groupId) { setLoading(false); return; }
    setLoading(true);
    setNotFound(false);

    const unsubs = [
      subscribeToGroup(groupId, g => {
        setGroup(g);
        setNotFound(g == null);
        setLoading(false);
      }),
      subscribeToGroupMembers(groupId, setMembers),
      subscribeToGroupWatchlist(groupId, setWatchlist),
    ];

    return () => unsubs.forEach(fn => fn());
  }, [groupId]);

  return { group, members, watchlist, loading, notFound };
}
