// src/types/recommendations.ts
import type { MediaType, WatchlistItem } from './domain';
import type { TMDBSearchResult } from './tmdb';

export type RowKind =
  | 'similar'
  | 'person'
  | 'genre-canon'
  | 'thematic'
  | 'trending'
  | 'latest-fav'
  | 'upcoming';

export interface RowId {
  kind: RowKind;
  // Disambiguators per kind:
  mediaType?: MediaType;   // similar
  tmdbId?: number;         // similar (the seed id)
  personId?: number;       // person
  genreId?: number;        // genre-canon
  keywordId?: number;      // thematic
}

/** Stable string-key for React + URL query-param. Format examples:
 *   similar:movie:603, person:140607, genre:18, keyword:9663,
 *   trending, latest-fav, upcoming
 */
export function rowKey(id: RowId): string {
  switch (id.kind) {
    case 'similar':    return `similar:${id.mediaType}:${id.tmdbId}`;
    case 'person':     return `person:${id.personId}`;
    case 'genre-canon': return `genre:${id.genreId}`;
    case 'thematic':   return `keyword:${id.keywordId}`;
    case 'trending':   return 'trending';
    case 'latest-fav': return 'latest-fav';
    case 'upcoming':   return 'upcoming';
  }
}

export function parseRowKey(key: string): RowId | null {
  if (key === 'trending') return { kind: 'trending' };
  if (key === 'latest-fav') return { kind: 'latest-fav' };
  if (key === 'upcoming') return { kind: 'upcoming' };
  if (key.startsWith('similar:')) {
    const [, mt, id] = key.split(':');
    if ((mt === 'movie' || mt === 'tv') && id) {
      return { kind: 'similar', mediaType: mt, tmdbId: Number(id) };
    }
    return null;
  }
  if (key.startsWith('person:')) {
    const id = Number(key.slice('person:'.length));
    return Number.isFinite(id) ? { kind: 'person', personId: id } : null;
  }
  if (key.startsWith('genre:')) {
    const id = Number(key.slice('genre:'.length));
    return Number.isFinite(id) ? { kind: 'genre-canon', genreId: id } : null;
  }
  if (key.startsWith('keyword:')) {
    const id = Number(key.slice('keyword:'.length));
    return Number.isFinite(id) ? { kind: 'thematic', keywordId: id } : null;
  }
  return null;
}

export interface Seed {
  tmdbId: number;
  mediaType: MediaType;
  rating: number;
  weight: 'strong' | 'weak';
  /** ISO date — used for recency-based scoring on row 9. */
  ratedAt: Date | null;
}

export interface RecurringPerson {
  id: number;
  name: string;
  recurrence: number;        // distinct 4-5★ titles
  knownFor: 'cast' | 'director';
  /** Highest vote_average among the user's titles featuring this person. */
  topTitleRating: number;
}

export interface RecurringKeyword {
  id: number;
  name: string;
  recurrence: number;
}

export interface DominantGenre {
  id: number;
  count: number;
}

/** What the cascade prioritizer takes as input. Pure data — no fetch fns. */
export interface CascadeInput {
  /** Most recent 5★ rating within 30 days, or null. */
  latestFiveStar: { tmdbId: number; mediaType: MediaType; daysSince: number } | null;
  strongSeeds: Seed[];   // 4-5★
  weakSeeds: Seed[];     // 3★
  recurringPeople: RecurringPerson[];
  recurringKeywords: RecurringKeyword[];
  dominantGenres: DominantGenre[];
  hasMyProviders: boolean;
  upcomingCount: number; // for row 10 score
}

/** What cascadePrioritizer returns: ordered list of rows with metadata. */
export interface RowSpec {
  id: RowId;
  rowKey: string;
  label: string;
  description?: string;
  score: number;
  jtbd: 'B' | 'C';
  /** When kind=similar, the seed item; when kind=person, the person; etc. */
  meta?: {
    seed?: Seed;
    person?: RecurringPerson;
    genre?: { id: number; name?: string };
    keyword?: RecurringKeyword;
  };
}

export interface FilterState {
  genre: string;          // genre id as string, or ''
  country: string;        // ISO-3166 country, or ''
  myProvidersOnly: boolean;
  decade: string;         // '1960'..'2020' or ''
  voteAverageMin: number; // 0..9 in 0.5 steps
  searchText: string;
}

export const DEFAULT_FILTERS: FilterState = {
  genre: '',
  country: '',
  myProvidersOnly: false,
  decade: '',
  voteAverageMin: 0,
  searchText: '',
};

/** A title in a row — TMDBSearchResult plus invariant media_type. */
export type RowTitle = TMDBSearchResult & { media_type: MediaType };

/** Visible vs backing-pool split returned from row hooks. */
export interface RowResult {
  rowSpec: RowSpec;
  visible: RowTitle[];
  backingPool: RowTitle[];
  isLoading: boolean;
}

/** Convenience used by seedAnalysis. */
export type RatedItem = WatchlistItem & { rating: number };
