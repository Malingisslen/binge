'use client';

import { useState, useRef, useCallback } from 'react';
import { UsersRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMyGroups } from '@/hooks/useGroups';
import { useClickOutside } from '@/hooks/useClickOutside';
import { addToGroupWatchlist, removeFromGroupWatchlist } from '@/lib/firebase/groups';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
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
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close);

  const refreshPresence = useCallback(async () => {
    const checks = await Promise.all(groups.map(async g => {
      const snap = await getDocs(collection(db, 'groups', g.id, 'watchlist'));
      const has = snap.docs.some(d => Number(d.id) === tmdbId);
      return [g.id, has] as const;
    }));
    setPresence(Object.fromEntries(checks));
  }, [groups, tmdbId]);

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
        className="px-[7px] py-[3px] border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-text-secondary hover:bg-surface-hover flex items-center gap-1"
      >
        <UsersRound size={12} />
        Grupp
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-[220px] bg-surface border border-border-main rounded-sm z-50 max-h-[260px] overflow-y-auto">
          {groups.map(g => {
            const isIn = presence[g.id] ?? false;
            const busy = working === g.id;
            return (
              <button
                key={g.id}
                disabled={busy}
                onClick={async () => {
                  setWorking(g.id);
                  try {
                    if (isIn) {
                      await removeFromGroupWatchlist(g.id, tmdbId);
                      setPresence(p => ({ ...p, [g.id]: false }));
                    } else {
                      await addToGroupWatchlist({
                        groupId: g.id, uid, tmdbId, mediaType, title, posterPath, releaseYear,
                      });
                      setPresence(p => ({ ...p, [g.id]: true }));
                    }
                  } finally {
                    setWorking(null);
                  }
                }}
                className="w-full text-left px-2 py-[5px] text-xs border-none bg-transparent font-[inherit] cursor-pointer hover:bg-surface-hover flex items-center gap-2 disabled:opacity-50"
              >
                <span className={`w-[14px] text-center ${isIn ? 'text-accent' : 'text-text-muted'}`}>
                  {isIn ? '✓' : ''}
                </span>
                <span className="truncate text-text-primary">{g.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
