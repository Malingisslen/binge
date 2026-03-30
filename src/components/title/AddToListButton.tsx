'use client';

import { useState, useRef, useCallback } from 'react';
import { List } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMyLists } from '@/hooks/useLists';
import { useClickOutside } from '@/hooks/useClickOutside';
import type { MediaType } from '@/types';

interface AddToListButtonProps {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
}

export default function AddToListButton({ tmdbId, mediaType, title, posterPath }: AddToListButtonProps) {
  const { uid } = useAuth();
  const { lists, addItemToList, removeItemFromList } = useMyLists();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close);

  if (!uid) return null;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-[7px] py-[3px] border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-text-secondary hover:bg-surface-hover flex items-center gap-1"
      >
        <List size={12} />
        Lista
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-[200px] bg-surface border border-border-main rounded-sm z-50 max-h-[200px] overflow-y-auto">
          {lists.length === 0 ? (
            <div className="px-2 py-2 text-xs text-text-muted">Inga listor. Skapa en i Listor-sidan.</div>
          ) : (
            lists.map(list => {
              const isInList = list.items.some(i => i.tmdbId === tmdbId);
              return (
                <button
                  key={list.id}
                  onClick={() => {
                    if (isInList) removeItemFromList(list.id, tmdbId);
                    else addItemToList(list.id, { tmdbId, mediaType, title, posterPath });
                  }}
                  className="w-full text-left px-2 py-[5px] text-xs border-none bg-transparent font-[inherit] cursor-pointer hover:bg-surface-hover flex items-center gap-2"
                >
                  <span className={`w-[14px] text-center ${isInList ? 'text-accent' : 'text-text-muted'}`}>
                    {isInList ? '✓' : ''}
                  </span>
                  <span className="truncate text-text-primary">{list.title}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
