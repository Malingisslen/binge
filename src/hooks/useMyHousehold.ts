'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMyGroups } from '@/hooks/useGroups';
import { createGroup } from '@/lib/firebase/groups';
import { DEFAULT_HOUSEHOLD_NAME, findMyHousehold } from '@/lib/household/household';

/** The signed-in user's household (ADR 0029), and a one-press way to create one. */
export function useMyHousehold() {
  const { uid, user } = useAuth();
  const { groups, loading } = useMyGroups(uid);
  const household = findMyHousehold(groups);
  const [creating, setCreating] = useState(false);
  // Set synchronously, so a double tap cannot start a second create before the first has
  // reached the live group list.
  const started = useRef(false);
  // A household that was deleted or left can be replaced by a new one from the same page.
  useEffect(() => { if (!loading && !household) started.current = false; }, [loading, household]);

  // One household per person: the button is locked while a create runs, and a second
  // create is refused while the live list already holds one.
  const create = useCallback(async (): Promise<string | null> => {
    if (!uid || !user || started.current || loading || household) return null;
    started.current = true;
    setCreating(true);
    try {
      const { groupId } = await createGroup({
        ownerUid: uid,
        ownerDisplayName: user.displayName,
        ownerUsername: user.username,
        ownerPhotoURL: user.photoURL,
        ownerProviders: user.myProviders ?? [],
        name: DEFAULT_HOUSEHOLD_NAME,
        defaults: { providerMode: 'intersect', aggregation: 'least_misery', mediaType: 'both' },
        kind: 'household',
      });
      // No invite link is cached: a household is joined only by invitation (ADR 0029).
      return groupId;
    } catch (err) {
      started.current = false;
      throw err;
    } finally {
      setCreating(false);
    }
  }, [uid, user, loading, household]);

  return { household, loading, creating, create };
}
