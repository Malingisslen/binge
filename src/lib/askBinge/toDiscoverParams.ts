// BIN-176 — map an AskFilter to TMDB discover params + human-readable chips.
//
// Pure (no fetch). The page calls askFilterToDiscoverParams() to build the
// movie/TV discover queries, and describeFilter() to render the interpreted filter
// as removable chips (so the user sees + can correct the parse).

import type { AskFilter } from './types';
import { MOODS } from '@/lib/moodLens';
import { genreLabel } from '@/lib/tmdb/genreLabels';
import { getProvider } from '@/lib/tmdb/providers';
import { runtimeBudgetLabel } from '@/lib/runtimeLens';

export interface DiscoverPlan {
  wantMovies: boolean;
  wantTV: boolean;
  movieParams: Record<string, string>;
  tvParams: Record<string, string>;
}

/** Union of explicit genres + the mood lens's genres (OR semantics for recall). */
function genreSet(filter: AskFilter): number[] {
  const set = new Set<number>(filter.genreIds ?? []);
  if (filter.mood) {
    const m = MOODS.find((x) => x.id === filter.mood);
    if (m) m.genreIds.forEach((id) => set.add(id));
  }
  return [...set];
}

export function askFilterToDiscoverParams(
  filter: AskFilter,
  opts: { myProviders?: number[] } = {},
): DiscoverPlan {
  const wantMovies = filter.mediaType !== 'tv';
  const wantTV = filter.mediaType !== 'movie';

  const genres = genreSet(filter);
  const providerIds = filter.providerIds?.length
    ? filter.providerIds
    : filter.myProvidersOnly
      ? (opts.myProviders ?? [])
      : [];

  const shared: Record<string, string> = {
    watch_region: 'SE',
    sort_by: filter.sortBy ?? 'popularity.desc',
  };
  if (genres.length) shared.with_genres = genres.join('|'); // OR
  if (providerIds.length) shared.with_watch_providers = providerIds.join('|');
  // Note: on /discover/tv this caps EPISODE runtime (min/episode), not total series
  // length — so it's a meaningful filter for film, looser for TV. Acceptable.
  if (filter.runtimeMax) shared['with_runtime.lte'] = String(filter.runtimeMax);
  if (filter.voteAverageMin) shared['vote_average.gte'] = String(filter.voteAverageMin);
  if (filter.originalLanguage) shared.with_original_language = filter.originalLanguage;

  // Quality floor so discover doesn't surface obscure no-vote entries.
  const movieParams: Record<string, string> = { ...shared, 'vote_count.gte': '100' };
  const tvParams: Record<string, string> = { ...shared, 'vote_count.gte': '50' };

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
  sv: 'Svenskt', da: 'Danskt', no: 'Norskt', ko: 'Koreanskt', ja: 'Japanskt', fr: 'Franskt', en: 'Engelskt',
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
  if (filter.runtimeMax) chips.push({ key: 'runtimeMax', label: runtimeBudgetLabel(filter.runtimeMax) });
  if (filter.providerIds?.length) {
    chips.push({ key: 'providerIds', label: filter.providerIds.map((id) => getProvider(id)?.shortName ?? `#${id}`).join(', ') });
  }
  if (filter.myProvidersOnly) chips.push({ key: 'myProvidersOnly', label: 'Mina tjänster' });
  if (filter.excludeSeen) chips.push({ key: 'excludeSeen', label: 'Osedda' });
  if (filter.voteAverageMin) chips.push({ key: 'voteAverageMin', label: `Betyg ≥ ${filter.voteAverageMin}` });
  if (filter.decade) chips.push({ key: 'decade', label: decadeLabel(filter.decade) });
  if (filter.originalLanguage) chips.push({ key: 'originalLanguage', label: LANG_LABEL[filter.originalLanguage] ?? filter.originalLanguage });
  if (filter.sortBy === 'vote_average.desc') chips.push({ key: 'sortBy', label: 'Högst betyg först' });
  return chips;
}
