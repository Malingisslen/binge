import type {
  TMDBSearchResponse,
  TMDBMovie,
  TMDBTVShow,
  TMDBSeasonDetail,
  TMDBSearchResult,
  TMDBListResponse,
  TMDBProviderData,
  TMDBPerson,
  TMDBPersonCredits,
} from '@/types';

const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

function getApiKey(): string {
  const key = process.env.NEXT_PUBLIC_TMDB_API_KEY;
  if (!key) throw new Error('NEXT_PUBLIC_TMDB_API_KEY is not set');
  return key;
}

// --- Concurrency-limiterad kö ---
// TMDB tillåter ~50 req/sek. Det drabbar oss inte från en enskild användare,
// men på dashboard/rådgivare kan vi fan-out:a 20+ parallella calls. Om något
// kör i bakgrunden eller användaren klickar snabbt vill vi inte slå i taket.
// En enkel semaphor cappar concurrency vid 8 — tillräckligt snabbt för UX,
// minskar risken för 429.

const MAX_CONCURRENT = 8;
let inFlight = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise(resolve => {
    waitQueue.push(() => {
      inFlight++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  inFlight--;
  const next = waitQueue.shift();
  if (next) next();
}

export interface TmdbFetchOpts {
  signal?: AbortSignal;
}

async function tmdbFetch<T>(
  path: string,
  params: Record<string, string> = {},
  opts: TmdbFetchOpts = {},
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('api_key', getApiKey());
  url.searchParams.set('language', 'sv-SE');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  // Pre-acquire: bailar direkt om abort-signalen redan triggats.
  if (opts.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  await acquireSlot();
  try {
    // Retry bara en gång på 429 — Retry-After respekteras om satt, annars
    // 1 s backoff. Ger ingen retry-stormvirvel i tight loops.
    let attempt = 0;
    while (true) {
      const res = await fetch(url.toString(), { signal: opts.signal });
      if (res.status === 429 && attempt < 1) {
        const retryAfter = Number(res.headers.get('Retry-After')) || 1;
        await new Promise(r => setTimeout(r, Math.min(retryAfter * 1000, 5000)));
        attempt++;
        continue;
      }
      if (!res.ok) {
        throw new Error(`TMDB API error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    }
  } finally {
    releaseSlot();
  }
}

// Images
export function posterUrl(path: string | null, size: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' = 'w342'): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

export function stillUrl(path: string | null, size: 'w185' | 'w300' | 'w500' = 'w300'): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

export function backdropUrl(path: string | null, size: 'w300' | 'w780' | 'w1280' | 'original' = 'w1280'): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

export function logoUrl(path: string | null, size: 'w45' | 'w92' | 'w154' | 'w185' = 'w92'): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

export function profileUrl(path: string | null, size: 'w45' | 'w185' | 'w500' = 'w185'): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

// Search
export function searchMulti(query: string, page = 1, opts?: TmdbFetchOpts): Promise<TMDBSearchResponse> {
  return tmdbFetch('/search/multi', { query, region: 'SE', page: String(page) }, opts);
}

// Movie
export function getMovie(id: number, opts?: TmdbFetchOpts): Promise<TMDBMovie> {
  return tmdbFetch(`/movie/${id}`, {
    append_to_response: 'watch/providers,recommendations,credits,videos',
  }, opts);
}

// TV
export function getTVShow(id: number, opts?: TmdbFetchOpts): Promise<TMDBTVShow> {
  return tmdbFetch(`/tv/${id}`, {
    append_to_response: 'watch/providers,recommendations,credits,videos,external_ids',
  }, opts);
}

// Recommendations (standalone — lighter than full detail call)
export function getRecommendations(mediaType: 'movie' | 'tv', id: number, opts?: TmdbFetchOpts): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch(`/${mediaType}/${id}/recommendations`, {}, opts);
}

// Person
export function getPerson(id: number, opts?: TmdbFetchOpts): Promise<TMDBPerson> {
  return tmdbFetch(`/person/${id}`, {}, opts);
}

export function getPersonEn(id: number, opts?: TmdbFetchOpts): Promise<TMDBPerson> {
  return tmdbFetch(`/person/${id}`, { language: 'en-US' }, opts);
}

export function getPersonCredits(id: number, opts?: TmdbFetchOpts): Promise<TMDBPersonCredits> {
  return tmdbFetch(`/person/${id}/combined_credits`, {}, opts);
}

export function getTVSeason(seriesId: number, seasonNumber: number, opts?: TmdbFetchOpts): Promise<TMDBSeasonDetail> {
  return tmdbFetch(`/tv/${seriesId}/season/${seasonNumber}`, {}, opts);
}

// Trending
export function getTrending(mediaType: 'all' | 'movie' | 'tv' = 'all', timeWindow: 'day' | 'week' = 'week', opts?: TmdbFetchOpts): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch(`/trending/${mediaType}/${timeWindow}`, {}, opts);
}

// Popular
export function getPopularMovies(page = 1, opts?: TmdbFetchOpts): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch('/movie/popular', { region: 'SE', page: String(page) }, opts);
}

export function getPopularTV(page = 1, opts?: TmdbFetchOpts): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch('/tv/popular', { region: 'SE', page: String(page) }, opts);
}

// Genres
export function getMovieGenres(opts?: TmdbFetchOpts): Promise<{ genres: { id: number; name: string }[] }> {
  return tmdbFetch('/genre/movie/list', {}, opts);
}

export function getTVGenres(opts?: TmdbFetchOpts): Promise<{ genres: { id: number; name: string }[] }> {
  return tmdbFetch('/genre/tv/list', {}, opts);
}

// Discover
export function discoverMovies(params: Record<string, string> = {}, opts?: TmdbFetchOpts): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch('/discover/movie', { region: 'SE', watch_region: 'SE', ...params }, opts);
}

export function discoverTV(params: Record<string, string> = {}, opts?: TmdbFetchOpts): Promise<TMDBListResponse<TMDBSearchResult>> {
  // region=SE filtrerar release-date-fönstret till svenska premiärdatum,
  // watch_region=SE filtrerar providers till vad som är tillgängligt i SE.
  // Båda behövs — annars får vi t.ex. globala premiärer som inte är svenska
  // OCH vi får providers från andra länder som är irrelevanta här.
  return tmdbFetch('/discover/tv', { region: 'SE', watch_region: 'SE', ...params }, opts);
}

// Watch providers (lightweight — no credits, recs, etc.)
export function getWatchProviders(mediaType: 'movie' | 'tv', id: number, opts?: TmdbFetchOpts): Promise<{ results: { SE?: TMDBProviderData } }> {
  return tmdbFetch(`/${mediaType}/${id}/watch/providers`, {}, opts);
}

// Helper: extract year from date string
export function extractYear(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const year = parseInt(dateStr.substring(0, 4), 10);
  return isNaN(year) ? null : year;
}

// Helper: get display title from search result.
// Prefers original title when it's in a Latin script (typically English),
// otherwise falls back to the localized (sv-SE) title.
export function getDisplayTitle(item: TMDBSearchResult): string {
  const localized = item.title || item.name;
  const original = item.original_title || item.original_name;
  if (original && !/[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0E00-\u0E7F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(original)) {
    return original;
  }
  return localized || original || 'Okänd titel';
}

// Helper: get release year from search result
export function getReleaseYear(item: TMDBSearchResult): number | null {
  return extractYear(item.release_date || item.first_air_date);
}
