'use client';

import { useState, useRef, useCallback } from 'react';
import { Plus, Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useToast } from '@/contexts/ToastContext';
import { statusLabel, statusOptionsFor } from '@/lib/watchStatus';
import { getTVShow } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import type { WatchStatus, MediaType, TMDBTVShow } from '@/types';

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
    // Specialfall: 'sedd' på TV = "alla avsnitt sedda". Översätt till
    // status='mina' + lastWatched satt till sista aireade avsnittet.
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
          totalSeasons: show.number_of_seasons ?? current?.totalSeasons ?? null,
          lastWatchedSeason: last?.season_number ?? show.number_of_seasons ?? current?.lastWatchedSeason ?? null,
          lastWatchedEpisode: last?.episode_number ?? current?.lastWatchedEpisode ?? null,
          providers: providers ?? current?.providers ?? [],
          genreIds: genreIds ?? current?.genreIds ?? [],
          tmdbStatus: show.status ?? current?.tmdbStatus ?? null,
        });
        toast(`${title} — ${labelFor('sedd')}`);
      } catch {
        toast(`Kunde inte hämta serieinfo, försök igen`);
      }
      return;
    }
    await addItem({
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
          {options.map(status => (
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
