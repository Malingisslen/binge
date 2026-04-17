import { discoverMovies, discoverTV, extractYear, getDisplayTitle } from '@/lib/tmdb/client';
import type {
  ProviderMode,
  SessionCandidate,
  SessionConfig,
  TMDBSearchResult,
} from '@/types';

const MAX_CANDIDATES = 30;

export function computeSessionProviders(
  participants: ReadonlyArray<{ providers: number[] }>,
  mode: ProviderMode,
): number[] {
  const lists = participants
    .map(p => p.providers)
    .filter(list => list.length > 0);

  if (lists.length === 0) return [];

  if (mode === 'intersect') {
    return lists.reduce<number[]>((acc, list, idx) => {
      const set = new Set(list);
      return idx === 0
        ? Array.from(set)
        : acc.filter(id => set.has(id));
    }, []);
  }

  // union
  const s = new Set<number>();
  for (const list of lists) list.forEach(id => s.add(id));
  return Array.from(s);
}

export async function generateCandidates(params: {
  config: SessionConfig;
  providers: number[];
}): Promise<SessionCandidate[]> {
  const { config, providers } = params;
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

  // Dedup + sort by popularity-ish (vote_average * count). Vi har bara vote_average här.
  const seen = new Set<string>();
  const deduped: SessionCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.mediaType}-${c.tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  deduped.sort((a, b) => b.voteAverage - a.voteAverage);

  return deduped.slice(0, MAX_CANDIDATES);
}

function resultToCandidate(r: TMDBSearchResult, mediaType: 'movie' | 'tv'): SessionCandidate {
  return {
    tmdbId: r.id,
    mediaType,
    title: getDisplayTitle({ ...r, media_type: mediaType }),
    posterPath: r.poster_path,
    year: extractYear(r.release_date || r.first_air_date),
    runtime: null,
    genreIds: r.genre_ids ?? [],
    voteAverage: r.vote_average,
    overview: r.overview,
    providers: [],
  };
}
