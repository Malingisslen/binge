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
import { planQuickRateWrite } from '@/lib/watchlistWrites';
import {
  LIBRARY_UNREACHABLE_TITLE,
  LIBRARY_UNREACHABLE_BODY,
  LIBRARY_RETRY_LABEL,
  LIBRARY_LOADING,
} from '@/lib/watchlist/libraryHoldCopy';

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
    // through here can't null out its stored rating. `current` is null at runtime in
    // this branch by construction (it is the 'add-as-seen' plan, which is returned
    // only for an absent item) — threaded through only so the signature stays honest
    // if the branch ever changes.
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
  // BIN-643: every verdict this modal reaches is `getItem`'s, and `getItem`
  // answers null for the whole library while the snapshot is unread — so
  // `planQuickRateWrite` returns 'add-as-seen' for a film the user has tracked
  // for years. That add carries `current: null`, which means `providers: []` over
  // stored provider data and no carry-forward of the rating. `libraryKnown`
  // (from the context, never re-derived here) is the gate; `listenerFailed` is
  // read separately because only that half needs a way out.
  const { addItem, getItem, updateRating, updateStatus, libraryKnown, listenerFailed, retryListener } = useWatchlist();
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
    // Belt-and-braces behind the disabled buttons: a modal opened before the
    // listener died must not write either.
    if (!libraryKnown) return;
    // Movie-only modal (discoverMovies + buildItemFromTmdb hardcodes 'movie').
    const existing = getItem('movie', t.id);
    // BIN-611: the "does this rating also move the status?" call lives in
    // planQuickRateWrite, next to buildStatusUpdate and unit-tested there —
    // BIN-599 fixed the rewatch-inflation here with no test to hold it down.
    const plan = planQuickRateWrite(existing);
    if (plan === 'add-as-seen') {
      await addItem(buildItemFromTmdb(t, 'sedd', rating, existing));
    } else {
      if (rating !== null) await updateRating('movie', t.id, rating);
      // 'rating-only' means the film is ALREADY 'sedd' — writing the status
      // again would be counted as a rewatch that never happened.
      if (plan === 'rating-and-status') await updateStatus('movie', t.id, 'sedd');
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
        {/* BIN-643 — the honest hold, above the cards so the disabled rating
            buttons below are never unexplained. Failed gets a retry (it never
            ends on its own); the first-snapshot wait gets a sentence. */}
        {!libraryKnown && (
          listenerFailed ? (
            <div role="alert" className="m-3 bg-danger-soft border border-danger/30 rounded-sm px-3 py-2">
              <p className="text-xs font-semibold text-danger-ink">{LIBRARY_UNREACHABLE_TITLE}</p>
              <p className="text-xs text-ink-2 mt-1">{LIBRARY_UNREACHABLE_BODY}</p>
              <button type="button" onClick={retryListener} className="btn btn-acc btn-sm mt-2">
                {LIBRARY_RETRY_LABEL}
              </button>
            </div>
          ) : (
            <p className="px-3 pt-3 text-xs text-ink-3">{LIBRARY_LOADING}</p>
          )
        )}
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
                  {/* The three rating buttons WRITE, so they hold on
                      `libraryKnown`. "Hoppa över" only advances local state —
                      disabling it would strand the visitor in a modal whose only
                      exit is the footer. */}
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => markRated(t, 5)} disabled={!libraryKnown} className="bg-acc-deep/10 text-acc-deep text-[10px] py-1 rounded-sm disabled:opacity-50">Sett 5★</button>
                    <button onClick={() => markRated(t, 4)} disabled={!libraryKnown} className="bg-acc-deep/10 text-acc-deep text-[10px] py-1 rounded-sm disabled:opacity-50">Sett 4★</button>
                    <button onClick={() => markRated(t, 3)} disabled={!libraryKnown} className="bg-surface border border-rule text-[10px] py-1 rounded-sm disabled:opacity-50">Sett 3★</button>
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
