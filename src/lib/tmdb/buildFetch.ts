// Byggtids-wrapper runt TMDB-detalj-fetchar (server-only, importeras bara från
// route-filernas generateStaticParams/generateMetadata/page).
//
// Varför: build:en pre-renderar ~25k titelsidor, var och en med ett TMDB-anrop.
// Under last stryper TMDB och anropen köar bakom klientens 8-slot-semafor; en
// sida som väntar förbi Next 60s-tak fäller HELA exporten (3 försök, sen abort).
// En AbortSignal.timeout gör att ett anrop ger upp i god tid → fetchern kastar →
// sidans generateMetadata/page faller tillbaka på tom metadata / undefined data
// (try/catch finns redan på alla anropställen) → bygget förblir grönt.
//
// Cachen (buildCache.ts) komponeras in nedan: cache-träff hoppar över fetchen
// helt, så en kod-deploy hämtar nästan inga titlar.

import { readBuildCache, writeBuildCache } from './buildCache';

type IdFetcher<T> = (id: number, opts?: { signal?: AbortSignal }) => Promise<T>;

// < Next 60s static-generation-tak med god marginal. Långt nog att en frisk
// fetch hinner klart även under måttlig kö, kort nog att aldrig nå taket.
export const BUILD_FETCH_TIMEOUT_MS = 20_000;

/** AbortSignal med byggtids-deadline. Används även för list-fetcharna i
 *  generateStaticParams (getPopular…/getTopRated…). */
export function buildSignal(): AbortSignal {
  return AbortSignal.timeout(BUILD_FETCH_TIMEOUT_MS);
}

export async function fetchForBuild<T>(
  kind: string,
  fetcher: IdFetcher<T>,
  id: number,
): Promise<T> {
  const cached = readBuildCache<T>(kind, id);
  if (cached !== null) return cached;
  const data = await fetcher(id, { signal: buildSignal() });
  writeBuildCache(kind, id, data);
  return data;
}
