export type MediaType = 'movie' | 'tv';
export type WatchStatus = 'följer' | 'vill_se' | 'sedd';

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
  genreIds: number[];
  tmdbStatus: string | null;
  addedAt: Date;
  updatedAt: Date;
  watchedAt: Date | null;
}

// Fas 3 — smakvektor (genre-viktad profil för taste-match)
export interface TasteVector {
  genres: Record<number, number>;
  sampleSize: number;
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

export interface ProviderPauseState {
  pausedAt: string;
  resumeAt: string | null;
}

export interface UserProfile {
  displayName: string;
  email: string;
  photoURL: string | null;
  username: string | null;
  bio: string;
  isPublic: boolean;
  myProviders: number[];
  defaultView: 'table' | 'grid';
  hideNonLatinTitles: boolean;
  hiddenCountries: string[];
  providerCosts: Record<number, number>;
  providerTiers: Record<number, string>;
  providerPauses: Record<number, ProviderPauseState>;
  calibrationGenres: Record<number, number> | null;
  createdAt: Date;
  updatedAt: Date;
  notificationSettings: {
    newEpisodes: boolean;
    availableOnMyServices: boolean;
  };
}

export interface UserList {
  id: string;
  uid: string;
  title: string;
  description: string;
  isPublic: boolean;
  items: UserListItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UserListItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  addedAt: Date;
}

export interface Review {
  id: string;
  uid: string;
  tmdbId: number;
  mediaType: MediaType;
  text: string;
  spoiler: boolean;
  rating: number | null;
  displayName: string;
  username: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Fas 5 — reviews-utbyggnad
export interface ReviewComment {
  id: string;
  uid: string;
  text: string;
  displayName: string;
  username: string | null;
  createdAt: Date;
}

// "Tillsammans ikväll" — session-baserad gemensam rekommendation
export type ProviderMode = 'intersect' | 'union';
export type AggregationStrategy = 'least_misery' | 'average' | 'fair';
export type SessionMediaType = 'movie' | 'tv' | 'both';
export type SessionStatus = 'active' | 'resolved' | 'expired';
export type VoteKind = 'yes' | 'no' | 'veto';

export interface SessionConfig {
  providerMode: ProviderMode;
  aggregation: AggregationStrategy;
  mediaType: SessionMediaType;
  maxRuntimeMin: number | null;
  allowAsymmetry: boolean;
}

export interface SessionCandidate {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  year: number | null;
  runtime: number | null;
  genreIds: number[];
  voteAverage: number;
  overview: string;
  providers: number[];
}

export interface TogetherSession {
  id: string;
  hostUid: string | null;
  hostName: string;
  config: SessionConfig;
  status: SessionStatus;
  candidates: SessionCandidate[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface SessionParticipant {
  id: string;
  uid: string | null;
  displayName: string;
  providers: number[];
  vetoRemaining: number;
  isHost: boolean;
  joinedAt: Date;
  lastActiveAt: Date;
}

export interface SessionSwipe {
  tmdbId: number;
  votes: Record<string, VoteKind>;
  updatedAt: Date;
}

// Permanenta grupper (Fas 2)
export type GroupRole = 'owner' | 'member';

export interface GroupDefaults {
  providerMode: ProviderMode;
  aggregation: AggregationStrategy;
  mediaType: SessionMediaType;
}

export interface Group {
  id: string;
  name: string;
  ownerUid: string;
  memberUids: string[];
  defaults: GroupDefaults;
  inviteToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMember {
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  providers: number[];
  role: GroupRole;
  joinedAt: Date;
  notifications: boolean;
}

export interface GroupWatchlistItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  addedBy: string;
  addedAt: Date;
  memberRatings: Record<string, number>;
}

// TMDB types
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

// Subscription advisor types
export type AdvisorStatus = 'active' | 'upcoming' | 'pause' | 'free';

export interface AdvisedShow {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  nextAirDate: string | null;
  nextEpisodeCode: string | null;
  isEnded: boolean;
  releaseDate: string | null;
  providerIds: number[];
}

export interface WillSeePerProviderRow {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  isSubscribed: boolean;
  monthlyCost: number | null;
  tvCount: number;
  movieCount: number;
}

export interface ProviderBase {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  shows: AdvisedShow[];
}

export interface ProviderAdvisory extends ProviderBase {
  monthlyCost: number | null;
  status: AdvisorStatus;
  nextAirDate: string | null;
}

export interface SubscribeAdvisory extends ProviderBase {
  nearestAirDate: string | null;
}

export interface ActivePause {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  pausedAt: string;
  resumeAt: string | null;
  monthlyCost: number;
  savingsSoFar: number;
}

export type PrimaryAction =
  | { kind: 'pause'; providerId: number; providerName: string; shortName: string; color: string; monthlyCost: number; nextAirDate: string | null }
  | { kind: 'catchup'; providerId: number; providerName: string; shortName: string; color: string; unfinishedCount: number; monthlyCost: number }
  | { kind: 'subscribe'; providerId: number; providerName: string; shortName: string; color: string; showCount: number; nearestAirDate: string | null; monthlyCost: number }
  | { kind: 'idle'; nextCheckDate: string | null };

export interface AdvisorResult {
  providers: ProviderAdvisory[];
  subscribeAdvice: SubscribeAdvisory[];
  willSeeByProvider: WillSeePerProviderRow[];
  monthlySavings: number;
  totalMonthlyCost: number;
  isLoading: boolean;
  primaryAction: PrimaryAction;
  activePauses: ActivePause[];
}
