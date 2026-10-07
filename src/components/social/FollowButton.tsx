'use client';

import { useAuth } from '@/hooks/useAuth';
import { useFollowing } from '@/hooks/useFollow';
import { Button } from '@/components/ui/Button';

export default function FollowButton({ targetUid }: { targetUid: string }) {
  const { uid } = useAuth();
  const { isFollowing, followUser, unfollowUser } = useFollowing();

  if (!uid || uid === targetUid) return null;

  const following = isFollowing(targetUid);

  return (
    <Button
      onClick={() => following ? unfollowUser(targetUid) : followUser(targetUid)}
      variant={following ? 'ghost' : 'acc'} size="sm"
    >
      {following ? 'Slutar följa' : 'Följ'}
    </Button>
  );
}
