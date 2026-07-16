'use client';

import { useQuery } from '@tanstack/react-query';
import { getPublicProfileCard } from '@/lib/firebase/publicProfile';

// Resolve a sender/inviter's display name + username from the public projection
// (BIN-505) via their uid, instead of trusting client-set fromDisplayName/
// fromUsername (forgeable — not rule-validated). Returns null when the projection
// isn't readable (private / not yet backfilled); callers fall back to the
// denormalized fields.
//
// SHARED so the friend-request chip (TopbarActions), the friends page
// (FriendsPageClient), and group invites (grupper) all resolve the SAME shape
// under the SAME `['sender-profile', uid]` React Query key. They previously each
// defined their own hook, and grupper's returned a bare string under that shared
// key — colliding in the cache and crashing React with "Objects are not valid as
// a React child" whenever both consumers ran for the same uid.
export interface SenderProfile {
  displayName: string | null;
  username: string | null;
}

export function useSenderProfile(uid: string | null | undefined) {
  return useQuery<SenderProfile | null>({
    queryKey: ['sender-profile', uid],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () => {
      const card = await getPublicProfileCard(uid!);
      if (!card) return null;
      return { displayName: card.displayName ?? null, username: card.username ?? null };
    },
  });
}
