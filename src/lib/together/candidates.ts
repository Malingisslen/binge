import { discoverMovies, discoverTV, extractYear, getDisplayTitle } from '@/lib/tmdb/client';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type {
  MediaType,
  ProviderMode,
  SessionCandidate,
  SessionConfig,
  TMDBSearchResult,
  WatchStatus,
} from '@/types';

const MAX_CANDIDATES = 30;

/**
 * Tmdb-ids ur ett bibliotek som INTE ska föreslås i en session (G4):
 * 'sedd' (redan sedd), 'avbruten' (gav upp) och påbörjade 'mina'-serier
 * (tittar redan). 'vill_se'-filmer och ej påbörjade 'mina'-serier behålls
 * medvetet — titlar man vill se men inte börjat är prima gemensamma
 * kandidater; att de dyker upp i sviparkortleken är önskat, inte buggen.
 * (== null, inte falsy: säsong 0/Specials räknas som påbörjad.)
 */
export function libraryExclusionIds(
  items: ReadonlyArray<{ mediaType: MediaType; tmdbId: number; status: WatchStatus; lastWatchedSeason?: number | null }>,
): Set<string> {
  // BIN-560 Phase 4: composite-keyed (mediaTypeDocId) — a 'both'-mode session mixes
  // movie + TV candidates, so a seen/dropped movie must not exclude a same-numbered
  // TV show from the swipe deck (or vice versa).
  const out = new Set<string>();
  for (const item of items) {
    if (item.status === 'vill_se') continue;
    if (item.status === 'mina' && item.lastWatchedSeason == null) continue;
    out.add(mediaTypeDocId(item.mediaType, item.tmdbId));
  }
  return out;
}

/**
 * Slår ihop samma titel från flera tjänst-sökningar till en kandidat som
 * vet vilka av tjänsterna den ligger på. Det är det som låter sessionen
 * filtrera på deltagarnas tjänster i stället för att släppa igenom allt.
 */
export function mergeCandidateProviders(
  hits: ReadonlyArray<{ candidate: SessionCandidate; providerId: number }>,
): SessionCandidate[] {
  const byKey = new Map<string, SessionCandidate>();
  for (const { candidate, providerId } of hits) {
    const key = mediaTypeDocId(candidate.mediaType, candidate.tmdbId);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...candidate, providers: [providerId] });
    } else if (!existing.providers.includes(providerId)) {
      existing.providers = [...existing.providers, providerId];
    }
  }
  return Array.from(byKey.values());
}

/**
 * Pure ranking-pipeline för sviparkortleken: exkludera → dedupa →
 * sortera på betyg → cappa till MAX_CANDIDATES. Extraherad ur
 * generateCandidates för att kunna testas utan TMDB-fetch.
 */
export function rankCandidates(
  candidates: ReadonlyArray<SessionCandidate>,
  excludeTmdbIds?: ReadonlySet<string>,
): SessionCandidate[] {
  const seen = new Set<string>();
  const deduped: SessionCandidate[] = [];
  for (const c of candidates) {
    if (excludeTmdbIds?.has(mediaTypeDocId(c.mediaType, c.tmdbId))) continue;
    const key = `${c.mediaType}-${c.tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  deduped.sort((a, b) => b.voteAverage - a.voteAverage);

  return deduped.slice(0, MAX_CANDIDATES);
}

export function computeSessionProviders(
  participants: ReadonlyArray<{ providers: number[] }>,
  mode: ProviderMode,
): number[] {
  if (participants.length === 0) return [];

  if (mode === 'intersect') {
    // Snittet ska nollas av en deltagare UTAN providers — inget är tittbart
    // för alla om någon saknar tjänster (M3). Tidigare filtrerades tomma
    // listor bort före snittet, så en oifylld profil visade partnerns hela
    // lista som "delad" och genererade kandidater ingen faktiskt kunde se.
    const allLists = participants.map(p => p.providers);
    if (allLists.some(list => list.length === 0)) return [];
    return allLists.reduce<number[]>((acc, list, idx) => {
      const set = new Set(list);
      return idx === 0
        ? Array.from(set)
        : acc.filter(id => set.has(id));
    }, []);
  }

  // union — tomma listor är harmlösa, ignorera dem.
  const s = new Set<number>();
  for (const p of participants) p.providers.forEach(id => s.add(id));
  return Array.from(s);
}

export async function generateCandidates(params: {
  config: SessionConfig;
  providers: number[];
  // Composite doc-id keys (mediaTypeDocId) — deltagarnas bibliotek + gruppens
  // gemensamma watchlist (G4). Discover hämtar en sida per medietyp
  // (20+20 titlar) så poolen tål normal exkludering utan extra fetch.
  excludeTmdbIds?: ReadonlySet<string>;
}): Promise<SessionCandidate[]> {
  const { config, providers, excludeTmdbIds } = params;
  const hits: Array<{ candidate: SessionCandidate; providerId: number }> = [];

  const baseParams: Record<string, string> = {
    watch_region: 'SE',
    sort_by: 'popularity.desc',
    'vote_count.gte': '50',
  };
  if (config.maxRuntimeMin) {
    baseParams['with_runtime.lte'] = String(config.maxRuntimeMin);
  }

  const wantMovies = config.mediaType === 'movie' || config.mediaType === 'both';
  const wantTV = config.mediaType === 'tv' || config.mediaType === 'both';

  // Sökning per tjänst så att sessionen vet var titeln går att se. providerId 0 = ingen tjänst känd.
  const lanes = providers.length > 0 ? providers : [0];
  const tasks: Promise<void>[] = [];

  for (const providerId of lanes) {
    const laneParams = { ...baseParams };
    if (providerId !== 0) {
      laneParams.with_watch_providers = String(providerId);
      laneParams.with_watch_monetization_types = 'flatrate';
    }

    if (wantMovies) {
      tasks.push(
        discoverMovies(laneParams).then(res => {
          for (const r of res.results) hits.push({ candidate: resultToCandidate(r, 'movie'), providerId });
        }).catch(() => {/* ignore */})
      );
    }
    if (wantTV) {
      // Runtime stöds inte för TV.
      const tvParams = { ...laneParams };
      delete tvParams['with_runtime.lte'];
      tasks.push(
        discoverTV(tvParams).then(res => {
          for (const r of res.results) hits.push({ candidate: resultToCandidate(r, 'tv'), providerId });
        }).catch(() => {/* ignore */})
      );
    }
  }

  await Promise.all(tasks);

  const merged = mergeCandidateProviders(hits).map(c => ({
    ...c,
    // providerId 0 betyder "ingen tjänst känd": lämna tomt så att den räknas som otaggad.
    providers: c.providers.filter(p => p !== 0),
  }));
  return rankCandidates(merged, excludeTmdbIds);
}

function resultToCandidate(r: TMDBSearchResult, mediaType: 'movie' | 'tv'): SessionCandidate {
  return {
    tmdbId: r.id,
    mediaType,
    title: getDisplayTitle(r),
    posterPath: r.poster_path,
    year: extractYear(r.release_date || r.first_air_date),
    runtime: null,
    genreIds: r.genre_ids ?? [],
    voteAverage: r.vote_average,
    overview: r.overview,
    providers: [],
  };
}
