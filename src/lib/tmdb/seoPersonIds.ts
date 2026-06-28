import { getPopularMovies, getMovie } from '@/lib/tmdb/client';
import {
  SEO_PERSON_SOURCE_MOVIE_PAGES,
  SEO_PERSON_CAST_PER_MOVIE,
  SEO_PERSON_TARGET_IDS,
} from './seoCoverage';

/**
 * Shared person-ID collection pipeline (BIN-337).
 *
 * Both src/app/sitemap.ts and src/app/person/[id]/page.tsx (generateStaticParams)
 * need the SAME set of person IDs, or the sitemap lists person URLs that aren't
 * pre-rendered → "Crawled – not indexed" soft-404s. Previously each re-implemented
 * the pipeline; this is the single source of truth.
 *
 * Lives here (not in the pure seoCoverage.ts) on purpose: this is a fetcher, so it
 * imports the TMDB client. seoCoverage.ts stays pure (constants + cappedTitleIds)
 * so its network-free unit test remains the trustworthy parity guard. (#15 ruling,
 * ADR 0005.)
 *
 * ORDER IS LOAD-BEARING (same contract as cappedTitleIds): popular-page order →
 * Set-insertion order of movie ids → per-movie top-`SEO_PERSON_CAST_PER_MOVIE`
 * cast → Set-insertion order of person ids → slice to `SEO_PERSON_TARGET_IDS`.
 * Which IDs survive the cap depends entirely on this order, so both callers MUST
 * go through this one function — don't reorder (e.g. collect in completion order).
 *
 * `signal` is a per-fetch factory so the build-time caller can inject a fresh
 * AbortSignal.timeout per request (buildSignal); the sitemap caller omits it.
 * Failed fetches are skipped (allSettled) — an empty result is valid for the
 * sitemap; the page caller layers its own ≥1 fallback on top.
 */
export async function collectPersonIds(
  opts?: { signal?: () => AbortSignal | undefined },
): Promise<number[]> {
  const sig = opts?.signal;
  const fetchOpts = () => (sig ? { signal: sig() } : undefined);

  const pages = Array.from({ length: SEO_PERSON_SOURCE_MOVIE_PAGES }, (_, i) => i + 1);
  const popularResults = await Promise.allSettled(pages.map(p => getPopularMovies(p, fetchOpts())));
  const movieIds = new Set<number>();
  for (const r of popularResults) {
    if (r.status === 'fulfilled') {
      for (const m of r.value.results) movieIds.add(m.id);
    }
  }

  const movieDetails = await Promise.allSettled(
    Array.from(movieIds).map(id => getMovie(id, fetchOpts())),
  );
  const peopleIds = new Set<number>();
  for (const r of movieDetails) {
    if (r.status === 'fulfilled') {
      const cast = r.value.credits?.cast ?? [];
      for (const c of cast.slice(0, SEO_PERSON_CAST_PER_MOVIE)) {
        if (c.id) peopleIds.add(c.id);
      }
    }
  }

  return Array.from(peopleIds).slice(0, SEO_PERSON_TARGET_IDS);
}
