'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useToast } from '@/contexts/ToastContext';
import { statusLabel } from '@/lib/watchStatus';
import { getTVShow } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { trackEvent } from '@/lib/analytics';
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
        await addItem({
          tmdbId, mediaType, status: 'mina', title, posterPath, releaseYear,
          rating: current?.rating ?? null,
          notes: current?.notes ?? null,
          totalSeasons: tvShow.number_of_seasons ?? input.totalSeasons ?? current?.totalSeasons ?? null,
          lastWatchedSeason: last?.season_number ?? current?.lastWatchedSeason ?? null,
          lastWatchedEpisode: last?.episode_number ?? current?.lastWatchedEpisode ?? null,
          providers: input.providers ?? current?.providers ?? [],
          genreIds: input.genreIds ?? current?.genreIds ?? [],
          tmdbStatus: tvShow.status ?? input.tmdbStatus ?? current?.tmdbStatus ?? null,
        });
      } catch {
        show('Kunde inte hämta serieinfo, försök igen');
        return;
      }
      promptRating();
      return;
    }

    await addItem({
      tmdbId, mediaType, status: 'sedd', title, posterPath, releaseYear,
      rating: current?.rating ?? null,
      notes: current?.notes ?? null,
      totalSeasons: input.totalSeasons ?? current?.totalSeasons ?? null,
      lastWatchedSeason: current?.lastWatchedSeason ?? null,
      lastWatchedEpisode: current?.lastWatchedEpisode ?? null,
      providers: input.providers ?? current?.providers ?? [],
      genreIds: input.genreIds ?? current?.genreIds ?? [],
      tmdbStatus: input.tmdbStatus ?? current?.tmdbStatus ?? null,
    });
    promptRating();
  }, [getItem, addItem, updateRating, show, showRating, queryClient]);
}
