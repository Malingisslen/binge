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

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('api_key', getApiKey());
  url.searchParams.set('language', 'sv-SE');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`TMDB API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
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
export function searchMulti(query: string, page = 1): Promise<TMDBSearchResponse> {
  return tmdbFetch('/search/multi', { query, region: 'SE', page: String(page) });
}

// Movie
export function getMovie(id: number): Promise<TMDBMovie> {
  return tmdbFetch(`/movie/${id}`, {
    append_to_response: 'watch/providers,recommendations,credits,videos',
  });
}

// TV
export function getTVShow(id: number): Promise<TMDBTVShow> {
  return tmdbFetch(`/tv/${id}`, {
    append_to_response: 'watch/providers,recommendations,credits,videos,external_ids',
  });
}

// Recommendations (standalone — lighter than full detail call)
export function getRecommendations(mediaType: 'movie' | 'tv', id: number): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch(`/${mediaType}/${id}/recommendations`);
}

// Person
export function getPerson(id: number): Promise<TMDBPerson> {
  return tmdbFetch(`/person/${id}`);
}

export function getPersonEn(id: number): Promise<TMDBPerson> {
  return tmdbFetch(`/person/${id}`, { language: 'en-US' });
}

export function getPersonCredits(id: number): Promise<TMDBPersonCredits> {
  return tmdbFetch(`/person/${id}/combined_credits`);
}

export function getTVSeason(seriesId: number, seasonNumber: number): Promise<TMDBSeasonDetail> {
  return tmdbFetch(`/tv/${seriesId}/season/${seasonNumber}`);
}

// Trending
export function getTrending(mediaType: 'all' | 'movie' | 'tv' = 'all', timeWindow: 'day' | 'week' = 'week'): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch(`/trending/${mediaType}/${timeWindow}`);
}

// Popular
export function getPopularMovies(page = 1): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch('/movie/popular', { region: 'SE', page: String(page) });
}

export function getPopularTV(page = 1): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch('/tv/popular', { region: 'SE', page: String(page) });
}

// Genres
export function getMovieGenres(): Promise<{ genres: { id: number; name: string }[] }> {
  return tmdbFetch('/genre/movie/list');
}

export function getTVGenres(): Promise<{ genres: { id: number; name: string }[] }> {
  return tmdbFetch('/genre/tv/list');
}

// Discover
export function discoverMovies(params: Record<string, string> = {}): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch('/discover/movie', { region: 'SE', watch_region: 'SE', ...params });
}

export function discoverTV(params: Record<string, string> = {}): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch('/discover/tv', { watch_region: 'SE', ...params });
}

// Watch providers (lightweight — no credits, recs, etc.)
export function getWatchProviders(mediaType: 'movie' | 'tv', id: number): Promise<{ results: { SE?: TMDBProviderData } }> {
  return tmdbFetch(`/${mediaType}/${id}/watch/providers`);
}

// Helper: extract year from date string
export function extractYear(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const year = parseInt(dateStr.substring(0, 4), 10);
  return isNaN(year) ? null : year;
}

// Helper: get display title from search result
export function getDisplayTitle(item: TMDBSearchResult): string {
  return item.title || item.name || 'Okänd titel';
}

// Helper: get release year from search result
export function getReleaseYear(item: TMDBSearchResult): number | null {
  return extractYear(item.release_date || item.first_air_date);
}
