// src/types/recommendations.ts
import { assertNever } from '@/lib/assertNever';
import type { MediaType } from './domain';
import type { TMDBSearchResult } from './tmdb';
import type { CompanionTitle } from '@/lib/franchise/companions';

export type RowId =
  | { kind: 'similar'; mediaType: MediaType; tmdbId: number }
  | { kind: 'person'; personId: number }
  | { kind: 'genre-canon'; genreId: number }
  | { kind: 'thematic'; keywordId: number }
  | { kind: 'trending' }
  | { kind: 'latest-fav' }
  | { kind: 'upcoming' }
  | { kind: 'free-public' }
  // BIN-583 — "Fortsätter som film". One aggregate row (not one per show): the
  // curated set is small, so per-anchor rows would be a cascade of one-item rows.
  | { kind: 'companion' };

/** Stable string-key for React + URL query-param.
 *   similar:movie:603, person:140607, genre:18, keyword:9663,
 *   trending, latest-fav, upcoming, free-public, companion
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
    case 'free-public': return 'free-public';
    case 'companion':   return 'companion';
    default:            return assertNever(id);
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
  if (key === 'free-public') return { kind: 'free-public' };
  if (key === 'companion') return { kind: 'companion' };
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
  /** Display title from WatchlistItem — used in row headings ("Liknar {title}"). */
  title: string;
  /** When the user rated the title — WatchlistItem.ratedAt, falling back to
   *  updatedAt for items rated before ratedAt existed (BIN-349). Row-9 recency. */
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

/**
 * WHY this show anchors the row, and therefore what the row's standfirst may say
 * about it (BIN-811, Malin's option (c), 2026-08-08).
 *
 * Not a widening: a TV title never leaves `mina` except to `avbruten`, so a show
 * the user has finished ALREADY anchors the row today — it was just described as
 * one the user "follows". The whole change is telling the two apart.
 *
 * `'finished'` is derived from `librarySubState`, which reads PERSISTED fields
 * only and is lazy-backfilled, so a finished show whose tmdbStatus/totalSeasons
 * were never written back reads as `'following'`. That direction is the safe one:
 * it never calls an airing show done.
 */
export type CompanionAnchorReason = 'following' | 'finished';

/**
 * BIN-583 — a followed show plus the curated follow-up film(s) the user does not
 * have in their library. Built by `selectCompanionAnchors`; `films` is never
 * empty, so the presence of an anchor is exactly "this row has something to show".
 *
 * BIN-811: `reason` says WHICH of the two ways this show qualifies — see
 * CompanionAnchorReason directly above.
 */
export interface CompanionAnchor {
  showTmdbId: number;
  showTitle: string;
  reason: CompanionAnchorReason;
  films: CompanionTitle[];
}

/** What the cascade prioritizer takes as input. Pure data — no fetch fns. */
export interface CascadeInput {
  /** Most recent 5★ rating within 30 days, or null. */
  latestFiveStar: { tmdbId: number; mediaType: MediaType; title: string; daysSince: number } | null;
  strongSeeds: Seed[];   // 4-5★
  weakSeeds: Seed[];     // 3★
  recurringPeople: RecurringPerson[];
  recurringKeywords: RecurringKeyword[];
  dominantGenres: DominantGenre[];
  hasMyProviders: boolean;
  upcomingCount: number; // for row 10 score
  /** BIN-583 — followed shows with an unwatched curated companion film. Empty =
   *  the "Fortsätter som film" row is not emitted at all. */
  companionAnchors: CompanionAnchor[];
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
    /** When kind=companion: the anchors whose films the row offers. */
    companions?: CompanionAnchor[];
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
  // Always-on filters härledda från user.profile (settings-sidan styr dem,
  // INTE filter-baren). Page komponenten synkar dessa när profilen läses in.
  hideNonLatinTitles: boolean;
  hiddenCountries: readonly string[];
}

export const DEFAULT_FILTERS: FilterState = {
  mediaType: 'all',
  genre: '',
  country: '',
  myProvidersOnly: false,
  decade: '',
  voteAverageMin: 0,
  searchText: '',
  hideNonLatinTitles: false,
  hiddenCountries: [],
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
