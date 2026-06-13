/**
 * Delade staleTime-nivåer för TMDB React Query-nycklar.
 *
 * Problem: flera hooks registrerar queries med samma queryKey (t.ex.
 * ['tv', id]) men olika staleTime. React Query använder det senast
 * registrerade observerns staleTime, så dashboard-rendering vs detail-
 * rendering ger olika refresh-beteende beroende på mount-ordning.
 *
 * Lösning: centrala konstanter per domän, importeras av alla callsites.
 * Ändringar sker på ett ställe och alla observers enas.
 *
 * Tumregel:
 * - DETAIL (10 min): användar-facing, tål kort stalenss. Next-episode
 *   kan flippa samma dag så låg staleTime behövs.
 * - CATALOG (30 min): listor som inte är tidskänsliga (popular, discover).
 * - STATIC (1 h): genre-mappar, person-bio — ändras sällan.
 * - SEARCH (5 min): debouncade användarsökningar.
 */

export const TMDB_STALE = {
  /** TV-show detail + detta som advisor/revival också läser. */
  TV_DETAIL: 10 * 60 * 1000,
  /** Lite-detalj för kalender/rådgivare ('tv-lite'/'movie-lite') — driver
   *  premiärbevakning, inte titelsidor. 6 h: air-datum flippar sällan
   *  intra-dag, och varje cache-miss är en fan-out över hela biblioteket. */
  LITE_DETAIL: 6 * 60 * 60 * 1000,
  /** Film-detail — inga next-air-date att oroa sig för. */
  MOVIE_DETAIL: 30 * 60 * 1000,
  /** Säsongsdata — episodernas air_date kan ändras men sällan. */
  SEASON: 30 * 60 * 1000,
  /** Trending/popular/discover — tål att vara lite stale. */
  CATALOG: 30 * 60 * 1000,
  /** Sök — skrivs om direkt när användaren skriver. */
  SEARCH: 5 * 60 * 1000,
  /** Personers credits/bio — ändras inte ofta. */
  PERSON: 60 * 60 * 1000,
  /** Genre-mapping — statiskt per språk. */
  GENRES: 60 * 60 * 1000,
  /** Watch providers-katalogen — ändras bara när TMDB lägger till en ny tjänst. */
  PROVIDERS: 60 * 60 * 1000,
  /** TMDB /recommendations + /similar — 30 min. Multi-callsite shared. */
  RECOMMENDATIONS: 30 * 60 * 1000,
  /** /person/{id}/combined_credits — ändras sällan. */
  PERSON_CREDITS: 4 * 60 * 60 * 1000,
  /** /movie/{id}/keywords + /tv/{id}/keywords. */
  KEYWORDS: 4 * 60 * 60 * 1000,
  /** /trending/all/week — region SE-puls. */
  TRENDING: 60 * 60 * 1000,
  /** /discover — genre-canon, upcoming, thematic. */
  DISCOVER: 2 * 60 * 60 * 1000,
} as const;
