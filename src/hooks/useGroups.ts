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
import type { AcceptInviteResult } from '@/lib/firebase/groups';
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

  // BIN-1166: utfallet RETURNERAS. Forr awaitades det och kastades bort, sa varken
  // ett nekande eller ett natverksfel nadde ytan — inbjudan lag kvar i listan utan
  // forklaring. Formen ar densamma som joinGroupViaToken redan har.
  //
  // BIN-1155: platshallaren 'Användare' ar borta. Medlemsdokumentets regel binder
  // numera namnet till skrivarens egen profil, sa ett platshallarnamn hade NEKATS —
  // samma fela som BIN-1127 stangde for gruppinbjudningar. Funktionen ar redan gatad
  // pa att profilen ar laddad (`!user` returnerar ovan), sa vardet finns.
  const accept = useCallback(async (groupId: string): Promise<AcceptInviteResult> => {
    if (!uid || !user) return { ok: false, reason: 'transient' };
    return acceptInvite({
      groupId,
      uid,
      displayName: user.displayName,
      username: user.username,
      photoURL: user.photoURL,
      providers: user.myProviders ?? [],
    });
  }, [uid, user]);

  const decline = useCallback(async (groupId: string) => {
    if (!uid) return;
    await declineInvite(uid, groupId);
  }, [uid]);

  return { invites, loading, accept, decline };
}
