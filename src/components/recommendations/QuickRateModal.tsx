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
import { buildWatchlistAddPayload, type WatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';

const MIN_QUICK_RATES = 5;

interface Props {
  open: boolean;
  onClose: () => void;
}

function buildItemFromTmdb(
  t: TMDBSearchResult,
  status: WatchlistItem['status'],
  rating: number | null,
  current: WatchlistItem | null,
): WatchlistAddPayload {
  const releaseYear = t.release_date ? Number(t.release_date.slice(0, 4)) : null;
  // Was the last call site still hand-filling the whole field list (BIN-582's
  // acceptance). The TV-only fields it used to write as explicit nulls are simply
  // omitted now — this flow only ever rates FILMS, so there is no season count or
  // episode position to clear, and omitting means an already-tracked title keeps
  // whatever it has instead of being reset by a quick rating.
  return buildWatchlistAddPayload({
    tmdbId: t.id,
    mediaType: 'movie',
    status,
    // `?? undefined` is the actual defence: no rating in this modal means "leave it
    // alone", never "clear it", so an unsettled snapshot routing a tracked title
    // through here can't null out its stored rating. `current` is null in this
    // branch by construction (TS narrows it after the `if (existing)` above) — it is
    // threaded through only so the signature stays honest if the branch ever changes.
    current,
    rating: rating ?? undefined,
    title: t.title ?? '',
    posterPath: t.poster_path ?? null,
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : null,
    genreIds: t.genre_ids ?? [],
    // New add from a search result — no provider data here (see OnboardingFlow).
    providers: [],
  });
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
    // Movie-only modal (discoverMovies + buildItemFromTmdb hardcodes 'movie').
    const existing = getItem('movie', t.id);
    if (existing) {
      if (rating !== null) await updateRating('movie', t.id, rating);
      // BIN-599: only WRITE the status when it actually changes. updateStatus
      // reads a 'sedd' → 'sedd' write as a rewatch and increments rewatchCount
      // (see buildStatusUpdate's isRewatch), so re-marking a film that is
      // already 'sedd' counted a viewing that never happened — once per pass
      // through this modal, and permanently: rewatchCount is editable nowhere.
      // This surface is a RATING pass ("Sett 4★"), not a viewing log, so the
      // only thing an already-seen film needs from it is the rating above.
      if (existing.status !== 'sedd') {
        await updateStatus('movie', t.id, 'sedd');
      }
    } else {
      await addItem(buildItemFromTmdb(t, 'sedd', rating, existing ?? null));
    }
    setRated(prev => new Set(prev).add(t.id));
  };

  const skip = (id: number) => {
    setRated(prev => new Set(prev).add(id));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-rule rounded-sm w-full max-w-3xl max-h-[80vh] overflow-y-auto">
        <header className="flex items-center justify-between p-3 border-b border-rule sticky top-0 bg-surface">
          <h2 className="text-sm font-bold">Snabb-betyg ({rated.size} markerade)</h2>
          <button onClick={onClose} className="text-ink-3" aria-label="Stäng"><X size={16} /></button>
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
                <div key={t.id} className={`border border-rule rounded-sm p-2 text-xs ${isRated ? 'opacity-50' : ''}`}>
                  {poster && (
                    <div className={`poster duo-${tone} mb-2`}>
                      <img src={poster} alt={t.title ?? ''} width={120} height={180} loading="lazy" decoding="async" />
                    </div>
                  )}
                  <div className="font-semibold mb-1 line-clamp-2">{t.title}</div>
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => markRated(t, 5)} className="bg-acc-deep/10 text-acc-deep text-[10px] py-1 rounded-sm">Sett 5★</button>
                    <button onClick={() => markRated(t, 4)} className="bg-acc-deep/10 text-acc-deep text-[10px] py-1 rounded-sm">Sett 4★</button>
                    <button onClick={() => markRated(t, 3)} className="bg-surface border border-rule text-[10px] py-1 rounded-sm">Sett 3★</button>
                    <button onClick={() => skip(t.id)} className="bg-surface border border-rule text-[10px] py-1 rounded-sm">Hoppa över</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <footer className="p-3 border-t border-rule flex justify-end sticky bottom-0 bg-surface">
          <button onClick={onClose} disabled={rated.size < MIN_QUICK_RATES} className="bg-acc-deep text-white text-xs px-4 py-2 rounded-sm disabled:opacity-50">
            Klar ({rated.size}/{MIN_QUICK_RATES})
          </button>
        </footer>
      </div>
    </div>
  );
}
