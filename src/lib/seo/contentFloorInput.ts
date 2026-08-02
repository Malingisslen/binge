/**
 * Adapters: TMDB detail objects → the framework-free ContentFloorInput.
 *
 * Shared by generateMetadata (the static <meta description>) and the page
 * clients (the visible <p className="syn"> fallback) so both surfaces describe
 * a title identically. Provider display names are canonicalised + deduped the
 * same way the rest of the app does (TV4 Play = 489 + alias 1944 → one entry).
 */

import type { TMDBMovie, TMDBTVShow, TMDBPerson, TMDBProvider, TMDBProviderData } from '@/types/tmdb';
import { canonicalProviderId, getProvider } from '@/lib/tmdb/providers';
import { translateDepartment } from '@/lib/tmdb/department';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import type { ContentFloorInput, PersonDescriptionInput } from './contentFloor';

const CAST_TAKE = 5;

function providerNames(list: TMDBProvider[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of list ?? []) {
    const name = getProvider(canonicalProviderId(p.provider_id))?.name ?? p.provider_name;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

function providerSplit(se: TMDBProviderData | undefined): ContentFloorInput['providers'] {
  return {
    stream: providerNames([...(se?.flatrate ?? []), ...(se?.free ?? []), ...(se?.ads ?? [])]),
    rent: providerNames(se?.rent),
    buy: providerNames(se?.buy),
  };
}

function topCast(credits?: { cast: { name: string; order: number }[] }): string[] {
  return (credits?.cast ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .slice(0, CAST_TAKE)
    .map((c) => c.name);
}

export function movieContentFloorInput(m: TMDBMovie): ContentFloorInput {
  return {
    id: m.id,
    kind: 'movie',
    title: preferOriginalTitle(m.title, m.original_title),
    year: m.release_date ? m.release_date.slice(0, 4) : null,
    genreIds: (m.genres ?? []).map((g) => g.id),
    runtimeMin: m.runtime ?? null,
    seasons: null,
    cast: topCast(m.credits),
    providers: providerSplit(m['watch/providers']?.results?.SE),
    overview: m.overview ?? '',
  };
}

export function tvContentFloorInput(s: TMDBTVShow): ContentFloorInput {
  return {
    id: s.id,
    kind: 'tv',
    title: preferOriginalTitle(s.name, s.original_name),
    year: s.first_air_date ? s.first_air_date.slice(0, 4) : null,
    genreIds: (s.genres ?? []).map((g) => g.id),
    runtimeMin: null,
    seasons: s.number_of_seasons ?? null,
    cast: topCast(s.credits),
    providers: providerSplit(s['watch/providers']?.results?.SE),
    overview: s.overview ?? '',
  };
}

/**
 * Person → PersonDescriptionInput. The third adapter, and the one that stops
 * /person's two halves from drifting: before BIN-686's review, generateMetadata
 * hand-sliced the bio at 180 chars while the client called buildPersonDescription,
 * so the pre-rendered description and the hydrated one disagreed on ~1000 pages.
 *
 * `biography` is TMDB's sv-SE bio verbatim — deliberately NOT the svenska-Wikipedia
 * bio the client also renders. See PersonDescriptionInput.biography for why the
 * licence forbids it here.
 */
export function personDescriptionInput(p: TMDBPerson): PersonDescriptionInput {
  return {
    name: p.name,
    biography: p.biography ?? '',
    role: p.known_for_department ? translateDepartment(p.known_for_department) : null,
    birthYear: p.birthday ? p.birthday.slice(0, 4) : null,
    birthPlace: p.place_of_birth,
  };
}
