// BIN-176 — "Ask Binge" natural-language search: the structured filter shape.
//
// A user sentence ("skräckfilm från 80-talet på Netflix jag inte sett") is parsed
// into this filter, which is then mapped to TMDB discover params + client-side
// exclusion. Parsing is deterministic (rule-based) first; an LLM fallback can fill
// the fuzzy residual later. See parseSearch.ts + toDiscoverParams.ts.

export type AskMood = 'mysig' | 'spanning' | 'skratta' | 'tankvard' | 'skrack';
export type AskSort = 'popularity.desc' | 'vote_average.desc';

export interface AskFilter {
  /** 'movie' or 'tv'; undefined = both. */
  mediaType?: 'movie' | 'tv';
  /** TMDB genre ids (movie/tv variants as appropriate). */
  genreIds?: number[];
  /** Mood lens (expanded to genres at discover time). */
  mood?: AskMood;
  /** Max runtime in minutes (30/60/90/120). */
  runtimeMax?: number;
  /** Explicit provider ids the user named. */
  providerIds?: number[];
  /** Restrict to the user's own subscribed providers. */
  myProvidersOnly?: boolean;
  /** Exclude already-seen / dropped / not-interested titles. */
  excludeSeen?: boolean;
  /** Minimum vote average (0.5 steps). */
  voteAverageMin?: number;
  /** Decade start year as string, e.g. '1980'. */
  decade?: string;
  /** ISO-639-1 original language, e.g. 'sv'. */
  originalLanguage?: string;
  /** Result ordering. */
  sortBy?: AskSort;
}
