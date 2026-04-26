// src/types/recommendations.ts
import type { MediaType } from './domain';
import type { TMDBSearchResult } from './tmdb';

export type RowId =
  | { kind: 'similar'; mediaType: MediaType; tmdbId: number }
  | { kind: 'person'; personId: number }
  | { kind: 'genre-canon'; genreId: number }
  | { kind: 'thematic'; keywordId: number }
  | { kind: 'trending' }
  | { kind: 'latest-fav' }
  | { kind: 'upcoming' };

/** Stable string-key for React + URL query-param.
 *   similar:movie:603, person:140607, genre:18, keyword:9663,
 *   trending, latest-fav, upcoming
 */
export function rowKey(id: RowId): string {
  switch (id.kind) {
    case 'similar':     return `similar:${id.mediaType}:${id.tmdbId}`;
    case 'person':      return `person:${id.personId}`;
    case 'genre-canon': return `genre:${id.genreId}`;
    case 'thematic':    return `keyword:${id.keywordId}`;
    case 'trending':    return 'trending';
    case 'latest-fav':  return 'latest-fav';
    case 'upcoming':    return 'upcoming';
  }
}

function parsePositiveInt(raw: string): number | null {
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseRowKey(key: string): RowId | null {
  if (key === 'trending') return { kind: 'trending' };
  if (key === 'latest-fav') return { kind: 'latest-fav' };
  if (key === 'upcoming') return { kind: 'upcoming' };
  if (key.startsWith('similar:')) {
    const parts = key.split(':');
    if (parts.length !== 3) return null;
    const [, mt, idRaw] = parts;
    if (mt !== 'movie' && mt !== 'tv') return null;
    const id = parsePositiveInt(idRaw);
    return id === null ? null : { kind: 'similar', mediaType: mt, tmdbId: id };
  }
  if (key.startsWith('person:')) {
    const id = parsePositiveInt(key.slice('person:'.length));
    return id === null ? null : { kind: 'person', personId: id };
  }
  if (key.startsWith('genre:')) {
    const id = parsePositiveInt(key.slice('genre:'.length));
    return id === null ? null : { kind: 'genre-canon', genreId: id };
  }
  if (key.startsWith('keyword:')) {
    const id = parsePositiveInt(key.slice('keyword:'.length));
    return id === null ? null : { kind: 'thematic', keywordId: id };
  }
  return null;
}

export interface Seed {
  tmdbId: number;
  mediaType: MediaType;
  rating: number;
  /** Timestamp from WatchlistItem.updatedAt — used by row 9 recency scoring. */
  ratedAt: Date | null;
}

export interface RecurringPerson {
  id: number;
  name: string;
  recurrence: number;        // distinct 4-5★ titles
  knownFor: 'cast' | 'director';
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
    genre?: { id: number };
    keyword?: RecurringKeyword;
  };
}

export type MediaTypeFilter = 'all' | 'movie' | 'tv';

export interface FilterState {
  mediaType: MediaTypeFilter;
  genre: string;          // genre id as string, or ''
  country: string;        // ISO-3166 country, or ''
  myProvidersOnly: boolean;
  decade: string;         // '1960'..'2020' or ''
  voteAverageMin: number; // 0..9 in 0.5 steps
  searchText: string;
}

export const DEFAULT_FILTERS: FilterState = {
  mediaType: 'all',
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
