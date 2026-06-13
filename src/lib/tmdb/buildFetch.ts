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
// Cache-lagret komponeras in i steg 3 (se buildCache.ts).

type IdFetcher<T> = (id: number, opts?: { signal?: AbortSignal }) => Promise<T>;

// < Next 60s static-generation-tak med god marginal. Långt nog att en frisk
// fetch hinner klart även under måttlig kö, kort nog att aldrig nå taket.
export const BUILD_FETCH_TIMEOUT_MS = 20_000;

/** AbortSignal med byggtids-deadline. Används även för list-fetcharna i
 *  generateStaticParams (getPopular…/getTopRated…). */
export function buildSignal(): AbortSignal {
  return AbortSignal.timeout(BUILD_FETCH_TIMEOUT_MS);
}

export function fetchForBuild<T>(fetcher: IdFetcher<T>, id: number): Promise<T> {
  return fetcher(id, { signal: buildSignal() });
}
