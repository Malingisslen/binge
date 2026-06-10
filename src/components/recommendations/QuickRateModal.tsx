'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { discoverMovies, posterUrl } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { useWatchlist } from '@/hooks/useWatchlist';
import { X } from 'lucide-react';
import { LoadingView } from '@/components/ui/LoadingView';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import type { WatchlistItem, TMDBSearchResult } from '@/types';

const MIN_QUICK_RATES = 5;

interface Props {
  open: boolean;
  onClose: () => void;
}

function buildItemFromTmdb(t: TMDBSearchResult, status: WatchlistItem['status'], rating: number | null): Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'> {
  const releaseYear = t.release_date ? Number(t.release_date.slice(0, 4)) : null;
  return {
    tmdbId: t.id,
    mediaType: 'movie',
    status,
    rating,
    notes: null,
    title: t.title ?? '',
    posterPath: t.poster_path ?? null,
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : null,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    providers: [],
    genreIds: t.genre_ids ?? [],
    tmdbStatus: null,
  };
}

export default function QuickRateModal({ open, onClose }: Props) {
  const { addItem, getItem, updateRating, updateStatus } = useWatchlist();
  const [rated, setRated] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['quick-rate-pool'],
    queryFn: () => discoverMovies({
      sort_by: 'popularity.desc',
      'vote_count.gte': '5000',
      region: 'SE',
      watch_region: 'SE',
    }),
    staleTime: TMDB_STALE.DISCOVER,
    enabled: open,
  });

  if (!open) return null;
  const titles = (data?.results ?? []).slice(0, 50);

  const markRated = async (t: TMDBSearchResult, rating: number | null) => {
    const existing = getItem(t.id);
    if (existing) {
      if (rating !== null) await updateRating(t.id, rating);
      await updateStatus(t.id, 'sedd');
    } else {
      await addItem(buildItemFromTmdb(t, 'sedd', rating));
    }
    setRated(prev => new Set(prev).add(t.id));
  };

  const skip = (id: number) => {
    setRated(prev => new Set(prev).add(id));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border-main rounded-sm w-full max-w-3xl max-h-[80vh] overflow-y-auto">
        <header className="flex items-center justify-between p-3 border-b border-border-main sticky top-0 bg-surface">
          <h2 className="text-sm font-bold">Snabb-betyg ({rated.size} markerade)</h2>
          <button onClick={onClose} className="text-text-muted" aria-label="Stäng"><X size={16} /></button>
        </header>
        {isLoading ? (
          <div className="p-8">
            <LoadingView label="Laddar titlar…" />
          </div>
        ) : (
          <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {titles.map(t => {
              const poster = posterUrl(t.poster_path, 'w185');
              const isRated = rated.has(t.id);
              const tone = t.genre_ids?.length ? toneForGenreIds(t.genre_ids) : toneForId(t.id);
              return (
                <div key={t.id} className={`border border-border-main rounded-sm p-2 text-xs ${isRated ? 'opacity-50' : ''}`}>
                  {poster && (
                    <div className={`poster duo-${tone} mb-2`}>
                      <img src={poster} alt={t.title ?? ''} width={120} height={180} loading="lazy" decoding="async" />
                    </div>
                  )}
                  <div className="font-semibold mb-1 line-clamp-2">{t.title}</div>
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => markRated(t, 5)} className="bg-accent/10 text-accent text-[10px] py-1 rounded-sm">Sett 5★</button>
                    <button onClick={() => markRated(t, 4)} className="bg-accent/10 text-accent text-[10px] py-1 rounded-sm">Sett 4★</button>
                    <button onClick={() => markRated(t, 3)} className="bg-surface border border-border-main text-[10px] py-1 rounded-sm">Sett 3★</button>
                    <button onClick={() => skip(t.id)} className="bg-surface border border-border-main text-[10px] py-1 rounded-sm">Hoppa över</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <footer className="p-3 border-t border-border-main flex justify-end sticky bottom-0 bg-surface">
          <button onClick={onClose} disabled={rated.size < MIN_QUICK_RATES} className="bg-accent text-white text-xs px-4 py-2 rounded-sm disabled:opacity-50">
            Klar ({rated.size}/{MIN_QUICK_RATES})
          </button>
        </footer>
      </div>
    </div>
  );
}
