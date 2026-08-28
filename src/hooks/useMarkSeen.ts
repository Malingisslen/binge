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
import { DELETION_IN_PROGRESS_MESSAGE, isDeletionInProgressError } from '@/lib/deletionInProgressError';
import type { MediaType, TMDBTVShow } from '@/types';

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

    const promptRating = (counted: boolean) => {
      // BIN-641: a counted rewatch says so. It is the app's only permanent,
      // un-editable write, and it is made on a screen that does not show the
      // count (Bibliotek renders "x2", the title page doesn't) — so without this
      // the user gets the same confirmation as an ordinary re-mark and no way to
      // tell the two apart. The rating nudge still wins when there is no rating:
      // that one asks for something, this one only confirms.
      //
      // BIN-895: `counted` is REPORTED BY THE WRITE — `outcomeOfAddWrite` reads it
      // off the payload Firestore received. It is not re-derived here, and must not
      // be: this closure holds the row as it was at RENDER, while the write path
      // re-reads the live ref after its own `await`. A remote status change in that
      // window used to make the toast claim an omtitt the counter never got, and the
      // counter is editable nowhere, so the sentence was the one thing left saying
      // it happened. BIN-655 did not close this (it turned intent into a function
      // choice, a different problem) — the answer now travels back instead.
      //
      // Nothing guards the mirror image, on purpose: "Sedd igen" only renders while
      // render state already says 'sedd', so a counted-but-silent write cannot occur
      // (Malin, 2026-08-16). The TV branch is covered for free — it writes 'mina',
      // which `rewatchFields` can never count, so the payload never carries the key.
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
      // BIN-895: declared out here rather than initialised to `false`, so a write that
      // never reports leaves this un-assigned (a compile error) instead of quietly
      // toasting "no rewatch". The catch below returns, so nothing reads it unless the
      // write assigned it.
      let counted: boolean;
      try {
        const tvShow = await queryClient.fetchQuery<TMDBTVShow>({
          queryKey: ['tv', tmdbId],
          queryFn: ({ signal }) => getTVShow(tmdbId, { signal }),
          staleTime: TMDB_STALE.TV_DETAIL,
        });
        const last = tvShow.last_episode_to_air;
        ({ countedRewatch: counted } = await write(buildWatchlistAddPayload({
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
        })));
      } catch (err) {
        // BIN-1025 follow-up (code review, 2026-08-27): this catch wraps BOTH the TMDB
        // fetch and the write, and since `writeTitle` began REFUSING during an account
        // deletion the refusal landed here and was reported as a failed series lookup.
        // "Försök igen" is wrong advice for it — the marker does not clear on its own, so
        // every retry fails identically. Same reasoning #19 Customer Support used to block
        // BIN-1032's generic message on `ReconsentGate`; the two screens must not disagree
        // about what a refused write means.
        if (isDeletionInProgressError(err)) {
          show(DELETION_IN_PROGRESS_MESSAGE);
          return;
        }
        show('Kunde inte hämta serieinfo, försök igen');
        return;
      }
      promptRating(counted);
      return;
    }

    // BIN-1038: the film branch had NO catch at all, so the refusal left here as an
    // unhandled rejection and the user saw nothing. Narrow on purpose — only the refusal is
    // answered; every other failure keeps propagating exactly as it did before, unhandled
    // and visible, because this branch has never had error handling to inherit.
    let countedRewatch: boolean;
    try {
      ({ countedRewatch } = await write(buildWatchlistAddPayload({
        tmdbId, mediaType, status: 'sedd', title, posterPath, releaseYear, current,
        // See the TV branch: null means "unknown, preserve", not "clear".
        totalSeasons: input.totalSeasons ?? undefined,
        providers: input.providers,
        // BIN-814: see the TV branch — the pair travels together or not at all.
        subscriptionProviders: input.subscriptionProviders,
        genreIds: input.genreIds,
        tmdbStatus: input.tmdbStatus ?? undefined,
      })));
    } catch (err) {
      if (isDeletionInProgressError(err)) {
        show(DELETION_IN_PROGRESS_MESSAGE);
        return;
      }
      throw err;
    }
    promptRating(countedRewatch);
  }, [getItem, upsertTitle, logViewing, updateRating, show, showRating, queryClient]);
}
