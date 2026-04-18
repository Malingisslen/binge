'use client';

import { useState, useRef, useCallback } from 'react';
import { Plus, Check } from 'lucide-react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useToast } from '@/contexts/ToastContext';
import { STATUS_LABELS, MOVIE_STATUS_LABELS } from '@/lib/watchStatus';
import type { WatchStatus, MediaType } from '@/types';

interface QuickAddButtonProps {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  providers?: number[];
  genreIds?: number[];
}

export default function QuickAddButton({
  tmdbId, mediaType, title, posterPath, releaseYear, providers, genreIds,
}: QuickAddButtonProps) {
  const { user, signIn } = useAuth();
  const { getItem, addItem, removeItem } = useWatchlist();
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getItem(tmdbId);
  const labels = mediaType === 'movie' ? MOVIE_STATUS_LABELS : STATUS_LABELS;
  const labelFor = (s: WatchStatus) => labels[s] ?? STATUS_LABELS[s];
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close);

  function handleSelect(status: WatchStatus) {
    addItem({
      tmdbId, mediaType, status, title, posterPath, releaseYear,
      rating: current?.rating ?? null,
      notes: current?.notes ?? null,
      totalSeasons: current?.totalSeasons ?? null,
      lastWatchedSeason: current?.lastWatchedSeason ?? null,
      lastWatchedEpisode: current?.lastWatchedEpisode ?? null,
      providers: providers ?? current?.providers ?? [],
      genreIds: genreIds ?? current?.genreIds ?? [],
      tmdbStatus: current?.tmdbStatus ?? null,
    });
    toast(`${title} — ${labelFor(status)}`);
    setOpen(false);
  }

  return (
    <div
      ref={ref}
      className="relative"
      onClick={e => { e.preventDefault(); e.stopPropagation(); }}
    >
      <button
        onClick={async () => {
          if (!user) {
            try { await signIn(); } catch { toast('Inloggning misslyckades'); }
            return;
          }
          setOpen(!open);
        }}
        className={`w-[28px] h-[28px] md:w-[22px] md:h-[22px] rounded-sm flex items-center justify-center border-none cursor-pointer ${
          current
            ? 'bg-accent text-white'
            : 'bg-black/60 text-white hover:bg-accent'
        }`}
        title={current ? labelFor(current.status) : 'Lägg till'}
      >
        {current ? <Check size={13} /> : <Plus size={13} />}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-surface border border-border-main rounded-sm z-50 min-w-[110px] shadow-lg">
          {(Object.keys(labels) as WatchStatus[]).map(status => (
            <button
              key={status}
              onClick={() => handleSelect(status)}
              className={`block w-full text-left px-2 py-[4px] text-xs font-[inherit] border-none cursor-pointer hover:bg-surface-hover ${
                current?.status === status ? 'text-accent font-semibold' : 'text-text-primary'
              } bg-transparent`}
            >
              {labelFor(status)}
            </button>
          ))}
          {current && (
            <>
              <div className="border-t border-border-light" />
              <button
                onClick={() => { removeItem(tmdbId); toast(`${title} borttagen`); setOpen(false); }}
                className="block w-full text-left px-2 py-[4px] text-xs font-[inherit] border-none cursor-pointer hover:bg-surface-hover text-red-600 bg-transparent"
              >
                Ta bort
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
