'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { discoverTV, getTVShowLite } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { useWatchlist } from './useWatchlist';
import { useNotInterested } from '@/contexts/NotInterestedContext';
import {
  selectDiscoveryPremieres,
  selectSeasonPremiereDiscoveries,
  mergeDiscoveries,
  type PremiereWindow,
  type DiscoveryPremiere,
} from '@/lib/calendar/premieres';
import type { TMDBTVShow } from '@/types';

// Upptäckt för Premiärer & finaler-sidan. TVÅ källor slås ihop till en rad:
//
//  Fas 1 (EAGER): stora NYA serier (S1) i fönstret via /discover/tv first_air_date.
//  Fas 2 (VISIBILITY-GATED): återkommande seriers säsongspremiärer (S≥2 E1) du inte
//    följer. En återkomsts premiärdatum är inte first_air_date, så vi kör
//    discover(air_date+returning) → capad kandidatpool → per-titel tv-lite-fan-out →
//    behåll next_episode_to_air = säsongspremiär. Fan-outen är dyr (upp till 20
//    tv-lite-anrop), så den gate:as på `seasonPremieresEnabled` (rader i vy) så den
//    aldrig tävlar med sidans egen personliga fan-out i 8-slot-semaforen vid mount.
//
// queryKey-huvudet 'discover-tv' är i persist-vitlistan → poolerna persisteras
// lagligt; per-titel-tv-lite persisteras ALDRIG (delas dock i cache med kalendern).

const PAGES = [1, 2] as const;

// Cappar per-titel-fan-outen — samma kostnadsgräns-mönster som
// useRecommendationsCascade (SEED_FETCH_CAP). Höj inte för att fylla en tunn lista;
// bredda hellre discover-sidorna (billiga + persisterade).
const CANDIDATE_CAP = 20;

export interface DiscoveryPremieresResult {
  premieres: DiscoveryPremiere[];
  isLoading: boolean;
}

export function useDiscoveryPremieres(
  window: PremiereWindow,
  { seasonPremieresEnabled = true }: { seasonPremieresEnabled?: boolean } = {},
): DiscoveryPremieresResult {
  const { items } = useWatchlist();
  const { items: notInterested, loading: notInterestedLoading } = useNotInterested();

  // Exkludera allt i biblioteket (vilken status som helst) plus avfärdade titlar.
  const excludedIds = useMemo(() => {
    // BIN-560 Phase 4: composite-keyed (mediaTypeDocId). This ALSO fixes a latent
    // partial bug: notInterested was previously added by bare tmdbId, so a movie
    // marked "not interested" could suppress a same-numbered TV premiere. Now a
    // movie's key ('movie_X') can never match this TV-only feed's checks ('tv_X').
    const set = new Set<string>();
    for (const it of items) if (it.mediaType === 'tv') set.add(mediaTypeDocId(it.mediaType, it.tmdbId));
    for (const ni of notInterested) set.add(mediaTypeDocId(ni.mediaType, ni.tmdbId));
    return set;
  }, [items, notInterested]);

  // --- Fas 1: nya serier (S1) — EAGER (oförändrat shippat beteende) ---
  const s1Queries = useQueries({
    queries: PAGES.map(page => ({
      queryKey: ['discover-tv', 'premiere-window', window.startIso, page] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        discoverTV({
          'first_air_date.gte': window.startIso,
          'first_air_date.lte': window.endIso,
          sort_by: 'popularity.desc',
          ...(page > 1 ? { page: String(page) } : {}),
        }, { signal }),
      staleTime: TMDB_STALE.DISCOVER,
    })),
  });
  const s1Pending = s1Queries.some(q => q.isPending);
  const s1Results = useMemo(
    () => s1Queries.flatMap(q => q.data?.results ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s1Queries.map(q => q.dataUpdatedAt).join(',')],
  );
  const s1 = useMemo(
    () => selectDiscoveryPremieres(s1Results, excludedIds, window),
    [s1Results, excludedIds, window],
  );

  // --- Fas 2: återkommande säsongspremiärer (S≥2 E1) — VISIBILITY-GATED ---
  // Kandidatpool: returnerande serier med ett avsnitt som sänds i fönstret.
  // air_date-filtret är grovt (vilket avsnitt som helst) — precisionen kommer
  // från next_episode_to_air-kollen i fan-outen nedan.
  const poolQueries = useQueries({
    queries: PAGES.map(page => ({
      queryKey: ['discover-tv', 'season-premiere-window', window.startIso, page] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        discoverTV({
          'air_date.gte': window.startIso,
          'air_date.lte': window.endIso,
          with_status: '0', // Returning Series
          sort_by: 'popularity.desc',
          ...(page > 1 ? { page: String(page) } : {}),
        }, { signal }),
      staleTime: TMDB_STALE.DISCOVER,
      enabled: seasonPremieresEnabled,
    })),
  });
  const poolPending = seasonPremieresEnabled && poolQueries.some(q => q.isPending);
  const poolResults = useMemo(
    () => poolQueries.flatMap(q => q.data?.results ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poolQueries.map(q => q.dataUpdatedAt).join(',')],
  );

  // Exkludera bibliotek/avfärdade FÖRE cappen så fan-out-slots inte slösas på
  // titlar vi ändå filtrerar bort. Dedupa id över sidorna, behåll popularitet.
  const candidateIds = useMemo(() => {
    const seen = new Set<number>();
    const ids: number[] = [];
    for (const r of poolResults) {
      if (excludedIds.has(mediaTypeDocId('tv', r.id)) || seen.has(r.id)) continue;
      seen.add(r.id);
      ids.push(r.id);
      if (ids.length >= CANDIDATE_CAP) break;
    }
    return ids;
  }, [poolResults, excludedIds]);

  // Per-titel-fan-out — SEPARAT useQueries (aldrig sammanslagen med kalenderns
  // egna tv-lite-fan-out; delar dock ['tv-lite', id]-cachen). Gate:ad så inget
  // fyras av innan raden syns.
  const showQueries = useQueries({
    queries: candidateIds.map(id => ({
      queryKey: ['tv-lite', id] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => getTVShowLite(id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
      enabled: seasonPremieresEnabled,
    })),
  });
  const fanoutPending =
    seasonPremieresEnabled && candidateIds.length > 0 && showQueries.some(q => q.isPending);
  const shows = useMemo(
    () => showQueries.map(q => q.data).filter((d): d is TMDBTVShow => d != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showQueries.map(q => q.dataUpdatedAt).join(',')],
  );
  const s2 = useMemo(
    () => selectSeasonPremiereDiscoveries(shows, excludedIds, window),
    [shows, excludedIds, window],
  );

  const premieres = useMemo(() => mergeDiscoveries(s1, s2), [s1, s2]);

  // isLoading: S2-termerna räknas BARA när seasonPremieresEnabled — en disabled
  // RQ-query rapporterar isPending=true utan cache, så utan denna kortslutning
  // skulle sektionen visa evig spinner medan gaten är stängd. notInterested-gate
  // (BIN-37) så avfärdade titlar inte blinkar in.
  //
  // Progressiv fyllning: när S1-listan redan har innehåll får den ANDRA vågen
  // (S2-poolen + fan-outen, som tänds när raden scrollas in) appenda — vi visar
  // INTE spinnern igen och blankar det redan renderade. Spinnern gäller bara
  // medan vi ännu inte har något att visa alls.
  const isLoading =
    s1Pending ||
    notInterestedLoading ||
    (premieres.length === 0 && (poolPending || fanoutPending));

  return { premieres, isLoading };
}
