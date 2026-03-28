export type MediaType = 'movie' | 'tv';
export type WatchStatus = 'följer' | 'sedd';

export interface WatchlistItem {
  tmdbId: number;
  mediaType: MediaType;
  status: WatchStatus;
  rating: number | null;
  notes: string | null;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  totalSeasons: number | null;
  lastWatchedSeason: number | null;
  lastWatchedEpisode: number | null;
  dropped: boolean;
  rewatchCount: number;
  providers: number[];
  addedAt: Date;
  updatedAt: Date;
  watchedAt: Date | null;
}

export interface EpisodeProgress {
  tmdbId: number;
  seasons: {
    [seasonNumber: string]: {
      [episodeNumber: string]: {
        watched: boolean;
        watchedAt: Date | null;
      };
    };
  };
}

export interface UserProfile {
  displayName: string;
  email: string;
  photoURL: string | null;
  myProviders: number[];
  createdAt: Date;
  updatedAt: Date;
  notificationSettings: {
    newEpisodes: boolean;
    availableOnMyServices: boolean;
  };
}

// TMDB types
export interface TMDBSearchResult {
  id: number;
  media_type: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids: number[];
}

export interface TMDBMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  runtime: number;
  vote_average: number;
  vote_count: number;
  genres: { id: number; name: string }[];
  credits?: {
    cast: TMDBCastMember[];
    crew: TMDBCrewMember[];
  };
  recommendations?: { results: TMDBSearchResult[] };
  'watch/providers'?: { results: { SE?: TMDBProviderData } };
}

export interface TMDBTVShow {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  last_air_date: string;
  vote_average: number;
  vote_count: number;
  genres: { id: number; name: string }[];
  number_of_seasons: number;
  number_of_episodes: number;
  status: string;
  seasons: TMDBSeason[];
  next_episode_to_air: TMDBEpisode | null;
  last_episode_to_air: TMDBEpisode | null;
  credits?: {
    cast: TMDBCastMember[];
    crew: TMDBCrewMember[];
  };
  recommendations?: { results: TMDBSearchResult[] };
  'watch/providers'?: { results: { SE?: TMDBProviderData } };
}

export interface TMDBSeason {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  poster_path: string | null;
  air_date: string;
  episode_count: number;
}

export interface TMDBSeasonDetail {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  episodes: TMDBEpisode[];
}

export interface TMDBEpisode {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  air_date: string;
  still_path: string | null;
  vote_average: number;
  runtime: number;
}

export interface TMDBCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface TMDBCrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
}

export interface TMDBProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
}

export interface TMDBProviderData {
  link: string;
  flatrate?: TMDBProvider[];
  rent?: TMDBProvider[];
  buy?: TMDBProvider[];
}

export interface TMDBSearchResponse {
  page: number;
  total_pages: number;
  total_results: number;
  results: TMDBSearchResult[];
}

export interface TMDBListResponse<T> {
  page: number;
  total_pages: number;
  total_results: number;
  results: T[];
}
