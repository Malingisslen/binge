// BIN-176 — map an AskFilter to TMDB discover params + human-readable chips.
//
// Pure (no fetch). The page calls askFilterToDiscoverParams() to build the
// movie/TV discover queries, and describeFilter() to render the interpreted filter
// as removable chips (so the user sees + can correct the parse).

import { formatStars, starsFromTmdb } from '@/lib/filters/titleFilters';
import type { AskFilter } from './types';
import { MOODS } from '@/lib/moodLens';
import { genreLabel } from '@/lib/tmdb/genreLabels';
import { getProvider } from '@/lib/tmdb/providers';
import { crossMediaGenreId } from '@/lib/tmdb/genreMapping';

export interface DiscoverPlan {
  wantMovies: boolean;
  wantTV: boolean;
  movieParams: Record<string, string>;
  tvParams: Record<string, string>;
}

function moodGenres(filter: AskFilter): number[] {
  return filter.mood ? (MOODS.find((x) => x.id === filter.mood)?.genreIds ?? []) : [];
}

const MOVIE_GENRES = new Set([28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770, 53, 10752, 37]);
const TV_GENRES = new Set([10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765, 10766, 10767, 10768, 37]);

// TMDB's series genres have no romance, horror, thriller, history or music, and
// the few series that still carry those film genres are an odd leftover set.
// Series are tagged with these keywords instead (ids checked on themoviedb.org
// 2026-10-12).
const TV_KEYWORD_FOR_MOVIE_GENRE: Record<number, number> = {
  10749: 9840, // romance
  27: 315058, // horror
  53: 316362, // thriller
  36: 192772, // historical drama
  10402: 4344, // musical
};

function toMediaGenre(id: number, media: 'movie' | 'tv'): number | null {
  if ((media === 'movie' ? MOVIE_GENRES : TV_GENRES).has(id)) return id;
  return crossMediaGenreId(id, media === 'movie' ? 'tv' : 'movie', media);
}

/**
 * One media type's genre filter, or null when the question named genres this
 * side cannot express (asking anyway would return its most popular titles of any
 * kind). Explicit and mood genres are ORed. A genre the series side lacks becomes
 * a keyword, which TMDB ANDs with the genres; a mood uses keywords only when none
 * of its genres exists on that side, so a broad mood is never narrowed to one.
 */
function genreParams(filter: AskFilter, media: 'movie' | 'tv'): Record<string, string> | null {
  const genres = new Set<number>();
  const keywords = new Set<number>();
  const keywordFor = (id: number) => (media === 'tv' ? TV_KEYWORD_FOR_MOVIE_GENRE[id] : undefined);
  for (const id of filter.genreIds ?? []) {
    const mapped = toMediaGenre(id, media);
    if (mapped != null) genres.add(mapped);
    else if (keywordFor(id)) keywords.add(keywordFor(id)!);
  }
  const mood = moodGenres(filter);
  const moodMapped = mood.map((id) => toMediaGenre(id, media)).filter((id): id is number => id != null);
  moodMapped.forEach((id) => genres.add(id));
  if (!moodMapped.length) mood.forEach((id) => { if (keywordFor(id)) keywords.add(keywordFor(id)!); });

  const asked = (filter.genreIds?.length ?? 0) > 0 || mood.length > 0;
  if (asked && !genres.size && !keywords.size) return null;
  const out: Record<string, string> = {};
  if (genres.size) out.with_genres = [...genres].join('|'); // OR
  if (keywords.size) out.with_keywords = [...keywords].join('|'); // OR
  return out;
}

export function askFilterToDiscoverParams(
  filter: AskFilter,
  opts: { myProviders?: number[]; hiddenCountries?: readonly string[] } = {},
): DiscoverPlan {
  const movieGenres = genreParams(filter, 'movie');
  const tvGenres = genreParams(filter, 'tv');
  const wantMovies = filter.mediaType !== 'tv' && movieGenres != null;
  // TMDB reads a series' runtime as minutes per EPISODE, so "under 90 min" let
  // whole series through. A length limit without "serie" in the question is
  // read as a film question.
  const wantTV = tvGenres != null && (filter.mediaType === 'tv' || (filter.mediaType !== 'movie' && !filter.runtimeMax));

  const providerIds = filter.providerIds?.length
    ? filter.providerIds
    : filter.myProvidersOnly
      ? (opts.myProviders ?? [])
      : [];

  const shared: Record<string, string> = {
    watch_region: 'SE',
    sort_by: filter.sortBy ?? 'popularity.desc',
  };
  if (providerIds.length) shared.with_watch_providers = providerIds.join('|');
  // On /discover/tv this caps minutes per episode (only reached when the
  // question asked for series).
  if (filter.runtimeMax) shared['with_runtime.lte'] = String(filter.runtimeMax);
  if (filter.voteAverageMin) shared['vote_average.gte'] = String(filter.voteAverageMin);
  if (filter.originalLanguage) shared.with_original_language = filter.originalLanguage;
  // Same server-side exclusion as Utforska, so hidden countries don't eat the
  // 40 titles per kind this page fetches; an explicit language wins.
  if (opts.hiddenCountries?.length && !filter.originalLanguage) {
    shared.without_origin_country = opts.hiddenCountries.join(',');
  }

  // Quality floor so discover doesn't surface obscure no-vote entries.
  const movieParams: Record<string, string> = { ...shared, ...movieGenres, 'vote_count.gte': '100' };
  const tvParams: Record<string, string> = { ...shared, ...tvGenres, 'vote_count.gte': '50' };

  if (filter.decade) {
    const start = `${filter.decade}-01-01`;
    const end = `${Number(filter.decade) + 9}-12-31`;
    movieParams['primary_release_date.gte'] = start;
    movieParams['primary_release_date.lte'] = end;
    tvParams['first_air_date.gte'] = start;
    tvParams['first_air_date.lte'] = end;
  }

  return { wantMovies, wantTV, movieParams, tvParams };
}

export interface FilterChip {
  key: keyof AskFilter;
  label: string;
}

const LANG_LABEL: Record<string, string> = {
  sv: 'Svenskt', da: 'Danskt', no: 'Norskt', fi: 'Finskt', is: 'Isländskt',
  ko: 'Koreanskt', ja: 'Japanskt', zh: 'Kinesiskt', th: 'Thailändskt',
  fr: 'Franskt', en: 'Engelskt', es: 'Spanskt', de: 'Tyskt', it: 'Italienskt',
  ru: 'Ryskt', hi: 'Indiskt', tr: 'Turkiskt', pl: 'Polskt', nl: 'Nederländskt',
  pt: 'Portugisiskt', ar: 'Arabiskt', el: 'Grekiskt',
};

function decadeLabel(decade: string): string {
  return Number(decade) >= 2000 ? `${decade}-talet` : `${decade.slice(2)}-talet`;
}

/** Human-readable chips for the interpreted filter, in display order. */
export function describeFilter(filter: AskFilter): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filter.mediaType) chips.push({ key: 'mediaType', label: filter.mediaType === 'movie' ? 'Filmer' : 'Serier' });
  if (filter.genreIds?.length) chips.push({ key: 'genreIds', label: filter.genreIds.map(genreLabel).join(', ') });
  if (filter.mood) chips.push({ key: 'mood', label: MOODS.find((m) => m.id === filter.mood)?.label ?? filter.mood });
  if (filter.runtimeMax) {
    chips.push({
      key: 'runtimeMax',
      label: filter.mediaType === 'tv' ? `Avsnitt på högst ${filter.runtimeMax} min` : `Filmer på högst ${filter.runtimeMax} min`,
    });
  }
  if (filter.providerIds?.length) {
    chips.push({ key: 'providerIds', label: filter.providerIds.map((id) => getProvider(id)?.shortName ?? `#${id}`).join(', ') });
  }
  if (filter.myProvidersOnly) chips.push({ key: 'myProvidersOnly', label: 'Mina tjänster' });
  if (filter.voteAverageMin) chips.push({ key: 'voteAverageMin', label: `${formatStars(starsFromTmdb(filter.voteAverageMin))}★ eller mer` });
  if (filter.decade) chips.push({ key: 'decade', label: decadeLabel(filter.decade) });
  if (filter.originalLanguage) chips.push({ key: 'originalLanguage', label: LANG_LABEL[filter.originalLanguage] ?? filter.originalLanguage });
  if (filter.sortBy === 'vote_average.desc') chips.push({ key: 'sortBy', label: 'Högst betyg först' });
  return chips;
}
