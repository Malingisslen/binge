// Domän-typer för Binge:s kärna (watchlist, profile, reviews, lists).
// TMDB-typer bor i tmdb.ts; social/together i social.ts; advisor i advisor.ts.

export type MediaType = 'movie' | 'tv';

// Sparad status. För TV är 'sedd' inte ett giltigt slutläge — TV vaknar från
// döden, får spinoffs, returnerar med nya säsonger. Istället bor TV-shows i
// 'mina' med ett *deriverat* sub-state (aktiv/ikapp/avslutad) baserat på
// progress + TMDB:s last_episode_to_air + tmdbStatus. Film stannar i 'sedd'
// som terminal — film är klar när den är klar.
//
// 'följer' togs bort som status under preprod-refactor. Lazy migration i
// WatchlistContext.docToItem normaliserar gamla Firestore-docs (TV 'följer'
// → 'mina', film 'följer' → 'sedd', TV 'sedd' → 'mina'). Nya skrivningar
// använder bara enum-värdena nedan.
export type WatchStatus = 'vill_se' | 'mina' | 'sedd' | 'avbruten';

// Härleds från progress + TMDB-data — aldrig sparad i Firestore. Används av
// /my/series sub-tabs, advisor-räkningar, och badges i kort/tabeller.
export type TvSubState = 'aktiv' | 'ikapp' | 'avslutad';

// Tre-state visibility för watchlist-items + user-profil.
// 'private'  — bara ägaren ser
// 'friends'  — ägare + bekräftade vänner ser (kräver mutuell vänskap)
// 'public'   — alla inloggade användare ser
export type ItemVisibility = 'private' | 'friends' | 'public';

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
  // Senast vi frågade TMDB om watch/providers.results.SE för denna titel.
  // null = aldrig frågat (cold). Sätts av backfillen oavsett om TMDB
  // returnerade providers eller tom lista — gör att vi kan särskilja
  // "checked-empty" från "never-checked" och periodiskt re-checka stale data.
  providersCheckedAt: Date | null;
  // Per-item visibility-override. När satt overrider den profilens
  // defaultVisibility för just denna titel. Optional — most items har null
  // och ärver default. Används t.ex. för att tracka guilty pleasures
  // ('private') trots publik default-profil.
  visibility: ItemVisibility | null;
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
  // Default visibility för publik profilvisning + nya watchlist-items.
  // Migration: legacy isPublic === true → 'public', annars → 'private'.
  // isPublic-fältet finns kvar denormaliserat för bakåt-kompatibilitet i
  // Firestore-regler under migrationsperioden men ska inte läsas i klienten.
  defaultVisibility: ItemVisibility;
  /** @deprecated — använd defaultVisibility. Bibehålls för rules-fallback. */
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
  // Admin-flagga för moderation-tools (/admin/reports/). Settas bara manuellt
  // via Firebase Console — klienten kan inte sätta detta själv (firestore.rules
  // enforce:ar). Undefined = vanlig användare.
  isAdmin?: boolean;
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
