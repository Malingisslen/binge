'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useToast } from '@/contexts/ToastContext';
import { statusLabel } from '@/lib/watchStatus';
import { getTVShow } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { trackEvent } from '@/lib/analytics';
import { buildWatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import { shouldPromptRating } from './useMarkSeen.helpers';
import type { MediaType, TMDBTVShow } from '@/types';

export interface MarkSeenInput {
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

/**
 * Single "markera sedd"-väg, delad av StatusButton + QuickAddButton.
 *
 * Film: status 'sedd' (terminal). Serie: 'sedd'-valet betyder "alla avsnitt
 * sedda" → lagras som 'mina' med lastWatched = sista aireade avsnittet
 * (oförändrad logik, BIN-14: ingen fejkad säsongsmarkör när last == null).
 *
 * Efter skrivet: om titeln saknar betyg, nudga ett betyg via stjärn-toasten;
 * annars vanlig bekräftelse-toast.
 */
export function useMarkSeen() {
  const { getItem, addItem, updateRating } = useWatchlist();
  const { show, showRating } = useToast();
  const queryClient = useQueryClient();

  return useCallback(async (input: MarkSeenInput) => {
    const { tmdbId, mediaType, title, posterPath, releaseYear } = input;
    const current = getItem(mediaType, tmdbId);

    const promptRating = () => {
      if (shouldPromptRating('sedd', current?.rating ?? null)) {
        showRating(`Betygsätt ${title}?`, (rating) => {
          void updateRating(mediaType, tmdbId, rating);
          trackEvent('rate_on_sedd', { mediaType });
        });
      } else {
        show(`${title} — ${statusLabel('sedd', mediaType)}`);
      }
    };

    if (mediaType === 'tv') {
      try {
        const tvShow = await queryClient.fetchQuery<TMDBTVShow>({
          queryKey: ['tv', tmdbId],
          queryFn: ({ signal }) => getTVShow(tmdbId, { signal }),
          staleTime: TMDB_STALE.TV_DETAIL,
        });
        const last = tvShow.last_episode_to_air;
        await addItem(buildWatchlistAddPayload({
          tmdbId, mediaType, status: 'mina', title, posterPath, releaseYear, current,
          // `?? undefined` is load-bearing: a null here must mean "we don't know,
          // keep what's stored", NOT "clear it". The helper writes an explicit null
          // straight through (StatusButton relies on that), so a call site that wants
          // null to fall through has to say so.
          totalSeasons: tvShow.number_of_seasons ?? input.totalSeasons ?? undefined,
          lastWatchedSeason: last?.season_number,
          lastWatchedEpisode: last?.episode_number,
          providers: input.providers,
          genreIds: input.genreIds,
          tmdbStatus: tvShow.status ?? input.tmdbStatus ?? undefined,
        }));
      } catch {
        show('Kunde inte hämta serieinfo, försök igen');
        return;
      }
      promptRating();
      return;
    }

    await addItem(buildWatchlistAddPayload({
      tmdbId, mediaType, status: 'sedd', title, posterPath, releaseYear, current,
      // See the TV branch: null means "unknown, preserve", not "clear".
      totalSeasons: input.totalSeasons ?? undefined,
      providers: input.providers,
      genreIds: input.genreIds,
      tmdbStatus: input.tmdbStatus ?? undefined,
    }));
    promptRating();
  }, [getItem, addItem, updateRating, show, showRating, queryClient]);
}
