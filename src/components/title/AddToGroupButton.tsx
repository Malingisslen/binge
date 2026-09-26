'use client';

import { useState, useRef, useCallback } from 'react';
import { UsersRound, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMyGroups } from '@/hooks/useGroups';
import { useClickOutside } from '@/hooks/useClickOutside';
import {
  addToGroupWatchlist,
  hasInGroupWatchlist,
  removeFromGroupWatchlist,
} from '@/lib/firebase/groups';
import { captureError } from '@/lib/sentry';
import type { MediaType } from '@/types';

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
  const { groups } = useMyGroups(uid);
  const [open, setOpen] = useState(false);
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

  const onOpen = () => {
    setOpen(v => {
      const next = !v;
      if (next) void refreshPresence();
      return next;
    });
  };

  if (!uid || groups.length === 0) return null;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={onOpen}
        className="px-[7px] py-[3px] border border-rule rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-ink-2 hover:bg-bg-2 flex items-center gap-1"
      >
        <UsersRound size={12} />
        Grupp
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-[220px] bg-surface border border-rule rounded-sm z-50 max-h-[260px] overflow-y-auto">
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
        </div>
      )}
    </div>
  );
}
