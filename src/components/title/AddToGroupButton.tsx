'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { UsersRound, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMyGroups } from '@/hooks/useGroups';
import { useClickOutside } from '@/hooks/useClickOutside';
import {
  getMyGroupIds,
  addToGroupWatchlist,
  hasInGroupWatchlist,
  removeFromGroupWatchlist,
} from '@/lib/firebase/groups';
import { captureError } from '@/lib/sentry';
import type { MediaType } from '@/types';
import { Button } from '@/components/ui/Button';
import { cardClass } from '@/components/ui/Card';

interface Props {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
}

export default function AddToGroupButton({
  tmdbId, mediaType, title, posterPath, releaseYear,
}: Props) {
  const { uid } = useAuth();
  const [open, setOpen] = useState(false);
  // PERF-6: whether to show the button at all comes from a one-shot, 5-min-cached read of
  // the user's group ids (shared with syncProgressToGroups). The live group listener only
  // opens with the menu. If that read fails the button shows anyway; the menu reads live.
  const [hasGroups, setHasGroups] = useState(false);
  useEffect(() => {
    setHasGroups(false);
    if (!uid) return;
    let cancelled = false;
    getMyGroupIds(uid)
      .then(ids => { if (!cancelled) setHasGroups(ids.length > 0); })
      .catch(() => { if (!cancelled) setHasGroups(true); });
    return () => { cancelled = true; };
  }, [uid]);
  const { groups, loading: groupsLoading } = useMyGroups(uid, { enabled: open });
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [working, setWorking] = useState<string | null>(null);
  // BIN-1298: the group watchlist rule refuses a write it does not recognise, so a
  // failed toggle has to say so instead of leaving the row looking unchanged.
  const [failed, setFailed] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close);

  const refreshPresence = useCallback(async () => {
    const checks = await Promise.all(
      groups.map(async g => [g.id, await hasInGroupWatchlist(mediaType, g.id, tmdbId)] as const),
    );
    setPresence(Object.fromEntries(checks));
  }, [groups, mediaType, tmdbId]);

  // The live list lands after the menu opens, so presence is checked when it does.
  const groupIdsKey = groups.map(g => g.id).join(',');
  useEffect(() => {
    if (open && groupIdsKey) void refreshPresence();
    // Re-read presence when the menu opens or the set of groups changes, not on every
    // live emission (a rename or member change re-emits the same groups).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupIdsKey]);

  const onOpen = () => setOpen(v => !v);

  if (!uid || !hasGroups) return null;

  return (
    <div className="relative inline-block" ref={ref}>
      <Button
        onClick={onOpen}
        variant="ghost" size="sm" className="flex items-center gap-1"
      >
        <UsersRound size={12} />
        Grupp
      </Button>
      {open && (
        <div className={cardClass('absolute left-0 top-full mt-1 w-[220px] z-50 max-h-[260px] overflow-y-auto')}>
          {groups.map(g => {
            const isIn = presence[g.id] ?? false;
            const busy = working === g.id;
            return (
              <button
                key={g.id}
                disabled={busy}
                onClick={async () => {
                  setWorking(g.id);
                  setFailed(null);
                  try {
                    if (isIn) {
                      await removeFromGroupWatchlist(mediaType, g.id, tmdbId);
                      setPresence(p => ({ ...p, [g.id]: false }));
                    } else {
                      await addToGroupWatchlist({
                        groupId: g.id, uid, tmdbId, mediaType, title, posterPath, releaseYear,
                      });
                      setPresence(p => ({ ...p, [g.id]: true }));
                    }
                  } catch (err) {
                    console.error('AddToGroupButton: group watchlist write failed', err);
                    captureError(err, { scope: 'groups', kind: isIn ? 'groupWatchlist-remove' : 'groupWatchlist-add' });
                    setFailed(g.id);
                  } finally {
                    setWorking(null);
                  }
                }}
                className="w-full text-left px-2 py-[5px] text-xs border-none bg-transparent font-[inherit] cursor-pointer hover:bg-bg-2 flex items-center gap-2 disabled:opacity-50"
              >
                <span className={`w-[14px] inline-flex items-center justify-center ${isIn ? 'text-acc-deep' : 'text-ink-3'}`}>
                  {isIn ? <Check size={11} /> : null}
                </span>
                <span className="truncate text-ink">{g.name}</span>
                {failed === g.id && (
                  <span role="alert" className="ml-auto shrink-0 text-danger-ink">Gick inte</span>
                )}
              </button>
            );
          })}
          {groupsLoading && (
            <div className="px-2 py-[5px] text-xs text-ink-3">Hämtar grupper…</div>
          )}
          {!groupsLoading && groups.length === 0 && (
            <div className="px-2 py-[5px] text-xs text-ink-3">Du är inte med i någon grupp.</div>
          )}
        </div>
      )}
    </div>
  );
}
