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
          ? 'bg-surface text-ink-2 border-rule hover:bg-bg-2'
          : 'bg-acc-deep text-white border-acc-deep'
      }`}
    >
      {following ? 'Slutar följa' : 'Följ'}
    </button>
  );
}
