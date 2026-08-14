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
import { rewatchFields } from '@/lib/watchlistWrites';
import { shouldPromptRating } from './useMarkSeen.helpers';
import type { MediaType, TMDBTVShow, WatchStatus } from '@/types';

export interface MarkSeenInput {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  totalSeasons?: number | null;
  providers?: number[];
  /** BIN-814: carried with `providers` so a re-mark cannot leave the two apart. */
  subscriptionProviders?: number[];
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
 *
 * BIN-641/BIN-655: `opts` selects WHICH write this hook calls — it is not decided
 * here, because this one hook serves two gestures that look identical at this
 * level. "Sedd" (the status choice) must not count a rewatch; "Sedd igen" must.
 * Passing nothing means no count, so a new call site is safe by omission. The
 * full reasoning lives on `WriteIntent` in src/lib/watchlistWrites.ts.
 */
export function useMarkSeen() {
  const { getItem, upsertTitle, logViewing, updateRating } = useWatchlist();
  const { show, showRating } = useToast();
  const queryClient = useQueryClient();

  return useCallback(async (input: MarkSeenInput, opts?: { countsAsViewing?: boolean }) => {
    const { tmdbId, mediaType, title, posterPath, releaseYear } = input;
    const current = getItem(mediaType, tmdbId);
    // BIN-655: the flag no longer travels INTO the write — it chooses which write.
    // Both entry points are reached from human actions (this hook is the mark-seen
    // path), but only "Sedd igen" is a user saying a NEW viewing happened; a plain
    // "Sedd" on an already-'sedd' title is a re-mark and must count nothing. That is
    // the distinction the old boolean carried one layer deeper, where a new caller
    // could forget it.
    const write = opts?.countsAsViewing ? logViewing : upsertTitle;

    const promptRating = () => {
      // BIN-641: a counted rewatch says so. It is the app's only permanent,
      // un-editable write, and it is made on a screen that does not show the
      // count (Bibliotek renders "x2", the title page doesn't) — so without this
      // the user gets the same confirmation as an ordinary re-mark and no way to
      // tell the two apart. The rating nudge still wins when there is no rating:
      // that one asks for something, this one only confirms.
      //
      // Asks the SAME helper the write asks, rather than re-deriving the rule —
      // otherwise the toast and the counter drift and the message becomes a lie.
      // `current != null` is null-safety, not a guarantee: it reads the render
      // closure while the write reads the live ref, so a remote status change in
      // between can still make this claim a rewatch the write did not count. The
      // reverse (silent but counted) cannot happen — the entry only renders while
      // render state says 'sedd'. BIN-655 did NOT close this: it made intent a
      // function choice rather than a flag, which is a different problem. The toast
      // still reads the render closure while the write reads the live ref, so the
      // race survives. Tracked in BIN-895.
      //
      // `writtenStatus` is the status the PAYLOAD carries, not a literal 'sedd':
      // the TV branch writes 'mina', and passing 'sedd' here would let a TV call
      // toast a rewatch over a write that counts nothing.
      const writtenStatus: WatchStatus = mediaType === 'tv' ? 'mina' : 'sedd';
      const counted = Boolean(opts?.countsAsViewing)
        && current != null
        && 'rewatchCount' in rewatchFields(writtenStatus, current.status, current.rewatchCount);
      if (shouldPromptRating('sedd', current?.rating ?? null)) {
        showRating(`Betygsätt ${title}?`, (rating) => {
          void updateRating(mediaType, tmdbId, rating);
          trackEvent('rate_on_sedd', { mediaType });
        });
      } else if (counted) {
        show(`${title} — omtitt räknad`);
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
        await write(buildWatchlistAddPayload({
          tmdbId, mediaType, status: 'mina', title, posterPath, releaseYear, current,
          // `?? undefined` is load-bearing: a null here must mean "we don't know,
          // keep what's stored", NOT "clear it". The helper writes an explicit null
          // straight through (StatusButton relies on that), so a call site that wants
          // null to fall through has to say so.
          totalSeasons: tvShow.number_of_seasons ?? input.totalSeasons ?? undefined,
          lastWatchedSeason: last?.season_number,
          lastWatchedEpisode: last?.episode_number,
          providers: input.providers,
          // BIN-814: the two provider fields must never be written apart. Accepting
          // the subset into MarkSeenInput and then not forwarding it is worse than
          // not accepting it — the caller believes it landed.
          subscriptionProviders: input.subscriptionProviders,
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

    await write(buildWatchlistAddPayload({
      tmdbId, mediaType, status: 'sedd', title, posterPath, releaseYear, current,
      // See the TV branch: null means "unknown, preserve", not "clear".
      totalSeasons: input.totalSeasons ?? undefined,
      providers: input.providers,
      // BIN-814: see the TV branch — the pair travels together or not at all.
      subscriptionProviders: input.subscriptionProviders,
      genreIds: input.genreIds,
      tmdbStatus: input.tmdbStatus ?? undefined,
    }));
    promptRating();
  }, [getItem, upsertTitle, logViewing, updateRating, show, showRating, queryClient]);
}
