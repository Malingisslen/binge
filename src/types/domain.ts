// Domän-typer för Binge:s kärna (watchlist, profile, reviews, lists).
// TMDB-typer bor i tmdb.ts; social/together i social.ts; advisor i advisor.ts.

export type MediaType = 'movie' | 'tv';
export type WatchStatus = 'följer' | 'vill_se' | 'sedd' | 'avbruten';

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
  // Timestamp + version of the Terms/Privacy version the user accepted at
  // sign-up. Optional because accounts created before the acceptance flow
  // shipped won't have it set.
  termsAcceptedAt?: Date;
  termsVersion?: string;
  // Onboarding-flödet satts när /onboarding/-sekvensen är klar. Undefined
  // = användaren kom in före feature:n landade ELLER hoppat över onboarding.
  // Vi gate:ar bara redirect-logiken på detta — ingen funktionalitet låses.
  onboardingCompletedAt?: Date;
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
