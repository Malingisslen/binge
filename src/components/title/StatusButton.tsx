'use client';

import { useState, useRef, useCallback } from 'react';
import type { WatchStatus, MediaType } from '@/types';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useToast } from '@/contexts/ToastContext';
import { STATUS_LABELS, MOVIE_STATUS_LABELS } from '@/lib/watchStatus';

interface StatusButtonProps {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  totalSeasons?: number | null;
  providers?: number[];
  genreIds?: number[];
}

export default function StatusButton({
  tmdbId,
  mediaType,
  title,
  posterPath,
  releaseYear,
  totalSeasons,
  providers,
  genreIds,
}: StatusButtonProps) {
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
      tmdbId,
      mediaType,
      status,
      rating: current?.rating ?? null,
      notes: current?.notes ?? null,
      title,
      posterPath,
      releaseYear,
      totalSeasons: totalSeasons ?? null,
      lastWatchedSeason: current?.lastWatchedSeason ?? null,
      lastWatchedEpisode: current?.lastWatchedEpisode ?? null,
      providers: providers ?? current?.providers ?? [],
      genreIds: genreIds ?? current?.genreIds ?? [],
    });
    toast(`${title} — ${labelFor(status)}`);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`px-[10px] py-[3px] border rounded-sm text-xs font-[inherit] cursor-pointer font-semibold ${
          current
            ? 'bg-accent text-white border-accent'
            : 'bg-accent text-white border-accent hover:bg-accent/90'
        }`}
      >
        {current ? labelFor(current.status) : '+ Lägg till'}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface border border-border-main rounded-sm z-40 min-w-[130px]">
          {(Object.keys(labels) as WatchStatus[]).map(status => (
            <button
              key={status}
              onClick={() => handleSelect(status)}
              className={`block w-full text-left px-3 py-[5px] text-xs font-[inherit] border-none cursor-pointer hover:bg-surface-hover ${
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
                className="block w-full text-left px-3 py-[5px] text-xs font-[inherit] border-none cursor-pointer hover:bg-surface-hover text-red-600 bg-transparent"
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
