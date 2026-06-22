// TMDB API response-typer. Fält-namn följer TMDB:s JSON-struktur (snake_case)
// där det behövs för att undvika onödig mappning.

export interface TMDBSearchResult {
  id: number;
  media_type: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids: number[];
  origin_country?: string[];
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
  imdb_id?: string | null;
  videos?: { results: TMDBVideo[] };
  recommendations?: { results: TMDBSearchResult[] };
  'watch/providers'?: { results: { SE?: TMDBProviderData } };
  release_dates?: { results: TMDBReleaseDatesByCountry[] };
  // Returneras direkt på /movie/{id} (ingen append behövs). null när filmen
  // inte hör till någon TMDB-samling/franchise.
  belongs_to_collection?: TMDBCollectionRef | null;
}

// Lättviktsreferensen som ligger på en film-detalj. Hela samlingen (med parts)
// hämtas separat via /collection/{id} → TMDBCollection.
export interface TMDBCollectionRef {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
}

// En film i en samling. Skiljer sig från TMDBSearchResult: /collection/{id}
// utelämnar `media_type` på parts (de är alltid filmer), så vi typar inte in
// ett fält som API:t aldrig skickar.
export interface TMDBCollectionPart {
  id: number;
  title?: string;
  original_title?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
  vote_count?: number;
  release_date?: string;
  genre_ids: number[];
}

export interface TMDBCollection {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts: TMDBCollectionPart[];
}

export interface TMDBReleaseDate {
  type: number;        // 1 Premiere · 3 Theatrical · 4 Digital · 5 Physical · 6 TV
  release_date: string; // ISO-8601 med tid (yyyy-mm-ddThh:mm:ss.sssZ)
  note: string;
}

export interface TMDBReleaseDatesByCountry {
  iso_3166_1: string;
  release_dates: TMDBReleaseDate[];
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
  // Per-episode runtime(s) in minutes; TMDB returns an array (often one value).
  // Used for BIN-93's runtime lens (episode_run_time[0]).
  episode_run_time?: number[];
  status: string;
  seasons: TMDBSeason[];
  next_episode_to_air: TMDBEpisode | null;
  last_episode_to_air: TMDBEpisode | null;
  credits?: {
    cast: TMDBCastMember[];
    crew: TMDBCrewMember[];
  };
  external_ids?: { imdb_id?: string | null };
  videos?: { results: TMDBVideo[] };
  recommendations?: { results: TMDBSearchResult[] };
  'watch/providers'?: { results: { SE?: TMDBProviderData } };
}

export interface TMDBVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface TMDBPerson {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  profile_path: string | null;
  known_for_department: string;
}

export interface TMDBPersonCredits {
  id: number;
  cast: (TMDBSearchResult & { character?: string })[];
  crew: (TMDBSearchResult & { job?: string; department?: string })[];
}

export interface TMDBPersonExternalIds {
  wikidata_id?: string | null;
  imdb_id?: string | null;
  facebook_id?: string | null;
  instagram_id?: string | null;
  twitter_id?: string | null;
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
  free?: TMDBProvider[];
  ads?: TMDBProvider[];
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
