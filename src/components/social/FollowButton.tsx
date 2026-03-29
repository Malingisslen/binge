'use client';

import { useAuth } from '@/hooks/useAuth';
import { useFollowing } from '@/hooks/useFollow';

export default function FollowButton({ targetUid }: { targetUid: string }) {
  const { uid } = useAuth();
  const { isFollowing, followUser, unfollowUser } = useFollowing();

  if (!uid || uid === targetUid) return null;

  const following = isFollowing(targetUid);

  return (
    <button
      onClick={() => following ? unfollowUser(targetUid) : followUser(targetUid)}
      className={`px-3 py-[3px] border rounded-sm text-xs font-[inherit] cursor-pointer ${
        following
          ? 'bg-surface text-text-secondary border-border-main hover:bg-surface-hover'
          : 'bg-accent text-white border-accent'
      }`}
    >
      {following ? 'Slutar följa' : 'Följ'}
    </button>
  );
}
