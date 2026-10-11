'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { dismissTip as dismiss, listTips, sendTip as send } from '@/lib/firebase/tips';
import type { Tip } from '@/lib/tips';
import type { MediaType } from '@/types';

const tipsKey = (uid: string | null) => ['tips', uid] as const;

// Tips sent to me. Same 60s staleTime as incoming friend requests: both sit in the
// "Väntar på dig" box and are read once per visit, not live.
export function useTips() {
  const { uid } = useAuth();
  return useQuery<Tip[]>({
    queryKey: tipsKey(uid),
    queryFn: () => uid ? listTips(uid) : Promise.resolve([]),
    enabled: !!uid,
    staleTime: 60_000,
  });
}

export function useTipActions() {
  const { uid } = useAuth();
  const queryClient = useQueryClient();

  const sendTip = useCallback(async (
    recipientUid: string,
    title: { mediaType: MediaType; tmdbId: number; title: string },
    note: string,
  ) => {
    if (!uid) throw new Error('Not signed in');
    await send(recipientUid, { fromUid: uid, ...title, note });
  }, [uid]);

  const dismissTip = useCallback(async (tipId: string) => {
    if (!uid) return;
    await dismiss(uid, tipId);
    queryClient.setQueryData<Tip[]>(tipsKey(uid), prev => prev?.filter(t => t.id !== tipId));
  }, [uid, queryClient]);

  return { sendTip, dismissTip };
}
