'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  subscribeToMyGroups,
  subscribeToGroup,
  subscribeToGroupMembers,
  subscribeToGroupWatchlist,
  subscribeToMyGroupInvites,
  acceptGroupInvite as acceptInvite,
  declineGroupInvite as declineInvite,
  type GroupInvite,
} from '@/lib/firebase/groups';
import { useAuth } from '@/hooks/useAuth';
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

// Inkomna grupp-inbjudningar + accept/decline-actions. accept använder inloggad
// användares profil (displayName/username/photoURL/myProviders) för member-doc:et.
export function useMyGroupInvites() {
  const { uid, user } = useAuth();
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setInvites([]); setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToMyGroupInvites(uid, inv => {
      setInvites(inv);
      setLoading(false);
    });
    return () => unsub();
  }, [uid]);

  const accept = useCallback(async (groupId: string) => {
    if (!uid || !user) return;
    await acceptInvite({
      groupId,
      uid,
      displayName: user.displayName ?? 'Användare',
      username: user.username ?? null,
      photoURL: user.photoURL ?? null,
      providers: user.myProviders ?? [],
    });
  }, [uid, user]);

  const decline = useCallback(async (groupId: string) => {
    if (!uid) return;
    await declineInvite(uid, groupId);
  }, [uid]);

  return { invites, loading, accept, decline };
}
