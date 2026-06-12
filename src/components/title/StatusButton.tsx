'use client';

import { useState, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WatchStatus, MediaType, TMDBTVShow } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useToast } from '@/contexts/ToastContext';
import { statusLabel, statusMenuLabel, statusOptionsFor } from '@/lib/watchStatus';
import { clearEpisodeProgress } from '@/lib/firebase/episodeProgress';
import { getTVShow } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';

interface StatusButtonProps {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  totalSeasons?: number | null;
  providers?: number[];
  genreIds?: number[];
  tmdbStatus?: string | null;
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
  tmdbStatus,
}: StatusButtonProps) {
  const { uid } = useAuth();
  const { getItem, addItem, removeItem } = useWatchlist();
  const { show: toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getItem(tmdbId);
  const options = statusOptionsFor(mediaType);
  const labelFor = (s: WatchStatus) => statusLabel(s, mediaType);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close);

  async function handleSelect(status: WatchStatus) {
    setOpen(false);
    // Specialfall (samma som QuickAddButton): 'sedd' på TV = "alla avsnitt
    // sedda". Översätt till status='mina' + lastWatched satt till sista
    // aireade avsnittet — annars skulle docen skrivas som rå 'sedd',
    // normaliseras till 'mina' vid läsning och landa som "Ej påbörjad".
    if (mediaType === 'tv' && status === 'sedd') {
      try {
        const show = await queryClient.fetchQuery<TMDBTVShow>({
          queryKey: ['tv', tmdbId],
          queryFn: ({ signal }) => getTVShow(tmdbId, { signal }),
          staleTime: TMDB_STALE.TV_DETAIL,
        });
        const last = show.last_episode_to_air;
        await addItem({
          tmdbId, mediaType, status: 'mina', title, posterPath, releaseYear,
          rating: current?.rating ?? null,
          notes: current?.notes ?? null,
          totalSeasons: show.number_of_seasons ?? totalSeasons ?? null,
          lastWatchedSeason: last?.season_number ?? show.number_of_seasons ?? current?.lastWatchedSeason ?? null,
          lastWatchedEpisode: last?.episode_number ?? current?.lastWatchedEpisode ?? null,
          providers: providers ?? current?.providers ?? [],
          genreIds: genreIds ?? current?.genreIds ?? [],
          tmdbStatus: show.status ?? tmdbStatus ?? current?.tmdbStatus ?? null,
        });
        toast(`${title} — ${labelFor('sedd')}`);
      } catch {
        toast('Kunde inte hämta serieinfo, försök igen');
      }
      return;
    }
    await addItem({
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
      tmdbStatus: tmdbStatus ?? current?.tmdbStatus ?? null,
    });
    toast(`${title} — ${labelFor(status)}`);
  }

  function handleRemove() {
    setOpen(false);
    // Serie med påbörjad historik: per-avsnitt-historiken sparas medvetet
    // (återtillägg återupptar där man var) — säg det och erbjud full
    // rensning. Se clearEpisodeProgress + docs/data-retention-policy.md.
    const ownerUid = uid;
    const hadProgress =
      mediaType === 'tv' && ownerUid != null && current?.lastWatchedSeason != null;
    void removeItem(tmdbId);
    if (hadProgress && ownerUid) {
      toast(`${title} borttagen. Avsnittshistoriken sparas.`, {
        label: 'Rensa helt',
        onClick: () => {
          void clearEpisodeProgress(ownerUid, tmdbId)
            .then(() => toast('Historiken rensad.'))
            .catch(() => toast('Kunde inte rensa historiken. Försök igen om en stund.'));
        },
      });
    } else {
      toast(`${title} borttagen`);
    }
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
          {options.map(status => (
            <button
              key={status}
              onClick={() => handleSelect(status)}
              className={`block w-full text-left px-3 py-[5px] text-xs font-[inherit] border-none cursor-pointer hover:bg-surface-hover ${
                current?.status === status ? 'text-accent font-semibold' : 'text-text-primary'
              } bg-transparent`}
            >
              {statusMenuLabel(status, mediaType)}
            </button>
          ))}
          {current && (
            <>
              <div className="border-t border-border-light" />
              <button
                onClick={handleRemove}
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
