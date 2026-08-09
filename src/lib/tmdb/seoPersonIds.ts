import { getPopularMovies, getMovie } from '@/lib/tmdb/client';
import { fetchForBuild } from '@/lib/tmdb/buildFetch';
import {
  SEO_PERSON_SOURCE_MOVIE_PAGES,
  SEO_PERSON_CAST_PER_MOVIE,
  SEO_PERSON_TARGET_IDS,
  latinDisplayIds,
} from './seoCoverage';

/**
 * Shared person-ID collection pipeline (BIN-337).
 *
 * Sedan BIN-823 finns EN anropare: `derive` i src/app/person/[id]/page.tsx.
 * Sitemapen härleder inte längre — den läser urvalsmanifestet som den
 * härledningen skrev, så pariteten är strukturell i stället för att bero på att
 * två kopior av den här pipelinen beter sig lika. (Ursprungligen, ADR 0005:
 * båda hade egna kopior, och driften mellan dem gav "Genomsökt – inte
 * indexerad" i GSC. Delvis ersatt av ADR 0018 Fork E.)
 *
 * Lives here (not in the pure seoCoverage.ts) on purpose: this is a fetcher, so it
 * imports the TMDB client. seoCoverage.ts stays pure (constants + cappedTitleIds)
 * so its network-free unit test remains the trustworthy parity guard. (#15 ruling,
 * ADR 0005.)
 *
 * ORDER IS LOAD-BEARING (same contract as cappedTitleIds): popular-page order →
 * Set-insertion order of movie ids → per-movie top-`SEO_PERSON_CAST_PER_MOVIE`
 * cast → Set-insertion order of person ids → slice to `SEO_PERSON_TARGET_IDS`.
 * Which IDs survive the cap depends entirely on this order. Since BIN-823 there
 * is only ONE caller (the person route's derivation; the sitemap reads the
 * manifest instead), so the order is no longer a cross-file contract — but it
 * still decides who gets a page, so don't collect in completion order.
 *
 * `signal` is a per-fetch factory so the build-time caller can inject a fresh
 * AbortSignal.timeout per request (buildSignal). It applies to the popular-list
 * phase only — the cast-detail phase goes through `fetchForBuild`, which
 * supplies its own `buildSignal()` per call (BIN-823).
 *
 * Failed fetches are skipped (allSettled), so a throttled run silently returns
 * FEWER ids rather than failing — measured 2026-08-08: 4 375 movie ids locally
 * against production's ~9 850. An empty result is no longer harmless: it flows
 * into `mergeManifest` (which then keeps the previous selection untouched) and
 * then into the coverage floor, which fails the build if nothing else rescues
 * it. That is deliberate — see selectionManifest.ts.
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

  // BIN-823: via fetchForBuild, inte rå getMovie. De här ~2 000 filmerna är
  // exakt samma dokument som titelsidorna redan cachar i .tmdb-cache — att gå
  // förbi cachen hämtade om dem varje bygge helt i onödan. Nu delar
  // personhärledningen den varma cachen med resten av bygget.
  const movieDetails = await Promise.allSettled(
    Array.from(movieIds).map(id => fetchForBuild('movie', getMovie, id)),
  );
  const peopleIds = new Set<number>();
  for (const r of movieDetails) {
    if (r.status === 'fulfilled') {
      const cast = r.value.credits?.cast ?? [];
      // Curation: skip non-Latin-named people (same rule as browsing/titles).
      // Filter AFTER the top-N slice so the per-movie cast order contract holds.
      for (const id of latinDisplayIds(cast.slice(0, SEO_PERSON_CAST_PER_MOVIE))) {
        peopleIds.add(id);
      }
    }
  }

  return Array.from(peopleIds).slice(0, SEO_PERSON_TARGET_IDS);
}
