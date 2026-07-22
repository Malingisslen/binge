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
  const candidates: SessionCandidate[] = [];

  const discoverParams: Record<string, string> = {
    watch_region: 'SE',
    sort_by: 'popularity.desc',
    'vote_count.gte': '50',
  };

  if (providers.length > 0) {
    discoverParams.with_watch_providers = providers.join('|');
    discoverParams.with_watch_monetization_types = 'flatrate';
  }

  if (config.maxRuntimeMin) {
    discoverParams['with_runtime.lte'] = String(config.maxRuntimeMin);
  }

  const wantMovies = config.mediaType === 'movie' || config.mediaType === 'both';
  const wantTV = config.mediaType === 'tv' || config.mediaType === 'both';

  const tasks: Promise<void>[] = [];

  if (wantMovies) {
    tasks.push(
      discoverMovies(discoverParams).then(res => {
        for (const r of res.results) {
          candidates.push(resultToCandidate(r, 'movie'));
        }
      }).catch(() => {/* ignore */})
    );
  }

  if (wantTV) {
    // Bygg om filter för TV (runtime stöds inte). Ta bort runtime.
    const tvParams = { ...discoverParams };
    delete tvParams['with_runtime.lte'];
    tasks.push(
      discoverTV(tvParams).then(res => {
        for (const r of res.results) {
          candidates.push(resultToCandidate(r, 'tv'));
        }
      }).catch(() => {/* ignore */})
    );
  }

  await Promise.all(tasks);

  return rankCandidates(candidates, excludeTmdbIds);
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
