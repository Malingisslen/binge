'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import {
  acceptFriendRequest as acceptRequest,
  cancelFriendRequest as cancelRequest,
  declineFriendRequest as declineRequest,
  getFriendStatus,
  listFriends,
  listFriendRequests,
  removeFriend as remove,
  sendFriendRequest as sendRequest,
  type FriendStatus,
  type FriendUser,
  type FriendRequest,
} from '@/lib/firebase/friends';

// Query-key fabriker för cache-invalidering. Konsekvent prefix gör det enkelt
// att invalidera alla friend-queries på en gång efter en mutation.
const friendsKey = (uid: string | null) => ['friends', uid] as const;
const requestsKey = (uid: string | null) => ['friend-requests', uid] as const;
const statusKey = (myUid: string | null, targetUid: string) =>
  ['friend-status', myUid, targetUid] as const;

// useFriends — bekräftade vänner. 5 min staleTime eftersom listan inte ändras
// ofta; mutations invaliderar explicit.
export function useFriends() {
  const { uid } = useAuth();
  return useQuery<FriendUser[]>({
    queryKey: friendsKey(uid),
    queryFn: () => uid ? listFriends(uid) : Promise.resolve([]),
    enabled: !!uid,
    staleTime: 5 * 60_000,
  });
}

// useFriendRequests — inkomna pending. Kortare staleTime (60s) eftersom
// nya förfrågningar är tidskänsliga (badge-räkning i sidofältet).
export function useFriendRequests() {
  const { uid } = useAuth();
  return useQuery<FriendRequest[]>({
    queryKey: requestsKey(uid),
    queryFn: () => uid ? listFriendRequests(uid) : Promise.resolve([]),
    enabled: !!uid,
    staleTime: 60_000,
  });
}

// useFriendStatus — relation mellan inloggad användare och en specifik
// target-uid. Används av profil-sidan för att rendera rätt knapp-state.
// Per-targetUid query-key så cache:n hålls separat.
export function useFriendStatus(targetUid: string | null) {
  const { uid } = useAuth();
  return useQuery<FriendStatus>({
    queryKey: statusKey(uid, targetUid ?? ''),
    queryFn: () => (uid && targetUid) ? getFriendStatus(uid, targetUid) : Promise.resolve('none'),
    enabled: !!uid && !!targetUid,
    staleTime: 60_000,
  });
}

// useFriendActions — mutations. Returnerar callbacks som invaliderar relevant
// cache efter lyckad write. Inte separata mutations eftersom alla rör samma
// underlying queries och vi vill ha enkel anrops-API i UI.
export function useFriendActions() {
  const { uid, user } = useAuth();
  const queryClient = useQueryClient();

  const invalidate = useCallback((targetUid?: string) => {
    queryClient.invalidateQueries({ queryKey: friendsKey(uid) });
    queryClient.invalidateQueries({ queryKey: requestsKey(uid) });
    if (targetUid) {
      queryClient.invalidateQueries({ queryKey: statusKey(uid, targetUid) });
    }
  }, [queryClient, uid]);

  const sendFriendRequest = useCallback(async (toUid: string) => {
    if (!uid || !user) return;
    await sendRequest(
      uid,
      user.displayName ?? 'Användare',
      user.photoURL ?? null,
      user.username ?? null,
      toUid,
    );
    invalidate(toUid);
  }, [uid, user, invalidate]);

  const cancelFriendRequest = useCallback(async (toUid: string) => {
    if (!uid) return;
    await cancelRequest(uid, toUid);
    invalidate(toUid);
  }, [uid, invalidate]);

  const acceptFriendRequest = useCallback(async (fromUid: string) => {
    if (!uid) return;
    await acceptRequest(uid, fromUid);
    invalidate(fromUid);
  }, [uid, invalidate]);

  const declineFriendRequest = useCallback(async (fromUid: string) => {
    if (!uid) return;
    await declineRequest(uid, fromUid);
    invalidate(fromUid);
  }, [uid, invalidate]);

  const removeFriend = useCallback(async (targetUid: string) => {
    if (!uid) return;
    await remove(uid, targetUid);
    invalidate(targetUid);
  }, [uid, invalidate]);

  return {
    sendFriendRequest,
    cancelFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
  };
}
