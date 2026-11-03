'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import {
  declineSessionInvite,
  listSessionInvites,
  openSessionInvite,
  type OpenSessionInviteResult,
} from '@/lib/firebase/sessionInvites';
import type { SessionInvite } from '@/lib/sessionInvites';

const invitesKey = (uid: string | null) => ['session-invites', uid] as const;

// Invites to a Tillsammans session sent to me. A shorter staleTime than tips: an invite
// is about tonight, and both the bell and the Vänner page read it.
export function useSessionInvites() {
  const { uid } = useAuth();
  return useQuery<SessionInvite[]>({
    queryKey: invitesKey(uid),
    queryFn: () => uid ? listSessionInvites(uid) : Promise.resolve([]),
    enabled: !!uid,
    staleTime: 30_000,
  });
}

export function useSessionInviteActions() {
  const { uid } = useAuth();
  const queryClient = useQueryClient();

  const dropFromCache = useCallback((inviteId: string) => {
    queryClient.setQueryData<SessionInvite[]>(invitesKey(uid), prev => prev?.filter(i => i.id !== inviteId));
  }, [uid, queryClient]);

  const decline = useCallback(async (inviteId: string) => {
    if (!uid) return;
    await declineSessionInvite(uid, inviteId);
    dropFromCache(inviteId);
  }, [uid, dropFromCache]);

  // The row stays in the cache when the session is gone, so it can show the empty
  // state; `dismissGone` takes it out once the person has read it.
  const join = useCallback(async (invite: SessionInvite): Promise<OpenSessionInviteResult> => {
    if (!uid) return { status: 'gone' };
    const result = await openSessionInvite(uid, invite);
    if (result.status === 'open') dropFromCache(invite.id);
    return result;
  }, [uid, dropFromCache]);

  return { decline, join, dismissGone: dropFromCache };
}
