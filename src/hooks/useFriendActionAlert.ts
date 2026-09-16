'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FriendAction } from '@/lib/friendActionText';

/**
 * BIN-1192 / BIN-1196 — one friend action's failed-write flag, plus the guard that
 * decides whether a failure that settles late is still about anything on screen.
 *
 * SCOPE IS ONE ROW, and that is the whole reason this is a hook rather than one flag
 * per surface. `FriendButton` renders a single relation, but the friends page and the
 * topbar popover render a LIST: a flag keyed only on the action would put the failure
 * from removing friend A next to friend B's name. Every row component calls this for
 * itself; nothing lifts it.
 *
 * `resetKey` is the value whose change means this button has become a DIFFERENT action
 * — `FriendButton` passes the relation status, because the other person accepting in
 * another tab turns "Lägg till vän" into "Vän" and an error about the old action is no
 * longer about anything visible. A list row has no such key and passes nothing: its row
 * disappears when the underlying relation changes, taking the flag with it.
 *
 * The attempt counter, not the key, is what makes a late failure droppable. Comparing
 * the key at settle time cannot work: a round trip can return it to the same value, and
 * the catch would then blame a second, unrelated request that never failed.
 */
export function useFriendActionAlert(resetKey?: unknown) {
  const [failedAction, setFailedAction] = useState<FriendAction | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    attemptRef.current += 1;
    setFailedAction(null);
  }, [resetKey]);

  // `write` is awaited, so the catch sees a refused write rather than a resolved
  // promise. Every action goes through here, so no action can be given an unhandled
  // rejection by being wired up later.
  const run = useCallback(
    (action: FriendAction, write: () => Promise<void>) => async () => {
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      setFailedAction(null);
      try {
        await write();
      } catch (err) {
        console.error(`friend action ${action} failed:`, err);
        // A newer click, or a reset, happened while this write was in flight. The
        // failure is real but no longer about anything the user is looking at.
        if (attemptRef.current !== attempt) return;
        setFailedAction(action);
      }
    },
    [],
  );

  return { failedAction, run };
}
