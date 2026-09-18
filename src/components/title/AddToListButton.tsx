'use client';

import { useState, useRef, useCallback } from 'react';
import { List, Check } from 'lucide-react';
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

  // Mutationerna fångar, rapporterar och säger till själva (BIN-1236, `useListMutations`).
  // Utfallet används inte här: bocken härleds ur `useMyLists` levande
  // onSnapshot-ögonblicksbild, så det finns ingen optimistisk ändring att ångra.
  //
  // `kind` bär anropsstället, så den här ytan går att skilja från listsidans i Sentry.
  const toggle = (listId: string, isInList: boolean) => isInList
    ? removeItemFromList(listId, tmdbId, { kind: 'removeItemFromList-quickAdd' })
    : addItemToList(listId, { tmdbId, mediaType, title, posterPath }, { kind: 'addItemToList-quickAdd' });

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-[7px] py-[3px] border border-rule rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-ink-2 hover:bg-bg-2 flex items-center gap-1"
      >
        <List size={12} />
        Lista
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-[200px] bg-surface border border-rule rounded-sm z-50 max-h-[200px] overflow-y-auto">
          {lists.length === 0 ? (
            <div className="px-2 py-2 text-xs text-ink-3">Inga listor. Skapa en i Listor.</div>
          ) : (
            lists.map(list => {
              const isInList = list.items.some(i => i.tmdbId === tmdbId);
              return (
                <button
                  key={list.id}
                  onClick={() => { void toggle(list.id, isInList); }}
                  className="w-full text-left px-2 py-[5px] text-xs border-none bg-transparent font-[inherit] cursor-pointer hover:bg-bg-2 flex items-center gap-2"
                >
                  <span className={`w-[14px] inline-flex items-center justify-center ${isInList ? 'text-acc-deep' : 'text-ink-3'}`}>
                    {isInList ? <Check size={11} /> : null}
                  </span>
                  <span className="truncate text-ink">{list.title}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
