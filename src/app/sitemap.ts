import type { MetadataRoute } from 'next';
import {
  getPopularMovies,
  getPopularTV,
  getTopRatedMovies,
  getTopRatedTV,
  getMovie,
} from '@/lib/tmdb/client';
import {
  SEO_TITLE_PAGES,
  SEO_TOP_RATED_PAGES,
  SEO_PERSON_SOURCE_MOVIE_PAGES,
  SEO_PERSON_CAST_PER_MOVIE,
  SEO_PERSON_TARGET_IDS,
} from '@/lib/tmdb/seoCoverage';

// Next 16 + output:'export' kräver explicit static/revalidate-deklaration
// för Metadata-routes. Vi vill att sitemap:en genereras en gång vid build
// och sedan är en statisk fil i out/.
export const dynamic = 'force-static';

/**
 * Dynamisk sitemap som genereras vid `next build`.
 *
 * Inkluderar:
 * - Statiska offentliga routes (start, discover, films, series, savings,
 *   integritet, villkor, community-guidelines)
 * - Topp-N populära + topp-rankade filmer/serier från TMDB
 * - Topp-N personer (top-billed cast från populära filmer)
 *
 * Mål: ge Google en bred "kanonisk lista" av sidor vi anser viktiga, så att
 * indexerings-prioriteten inte tilldelas slumpvis via on-page crawl-discovery.
 *
 * **Sitemap MÅSTE adressera samma URL-mängd som pre-rendren** i
 * src/app/movie/[id]/page.tsx, src/app/tv/[id]/page.tsx och
 * src/app/person/[id]/page.tsx. Diskrepans → "Genomsökt – inte indexerad"
 * i GSC. Därför importerar vi samma konstanter från @/lib/tmdb/seoCoverage.
 *
 * Privata routes (/my, /settings, /stats, /grupper, /feed, /login,
 * /kalibrera) exkluderas eftersom de kräver auth. De har även
 * robots: index: false via sina layout.tsx-filer + Disallow i robots.txt.
 *
 * Körs bara vid build — TMDB-calls här räknas mot byggtid inte runtime.
 * Om TMDB-calls failar (nätverk/rate-limit) faller sitemap tillbaka till
 * bara statiska routes istället för att bryta hela build:en.
 */

const SITE_URL = 'https://binge.nu';

function staticEntries(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'daily', priority: 1.0 },
    { url: `${SITE_URL}/discover/`, lastModified, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/films/`, lastModified, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/series/`, lastModified, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/savings/`, lastModified, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${SITE_URL}/integritet/`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/villkor/`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/community-guidelines/`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ];
}

type Fetcher = (page: number) => Promise<{ results: { id: number }[] }>;

async function collectIds(fetcher: Fetcher, pageCount: number): Promise<Set<number>> {
  const ids = new Set<number>();
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  // 8-concurrent semaphoren i client.ts skyddar mot 429 även om vi fire:ar
  // alla pages samtidigt.
  const results = await Promise.allSettled(pages.map(p => fetcher(p)));
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const item of r.value.results) {
        if (item.id) ids.add(item.id);
      }
    }
  }
  return ids;
}

async function titleEntries(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = [];

  const [popularMovies, topMovies, popularTV, topTV] = await Promise.all([
    collectIds(getPopularMovies, SEO_TITLE_PAGES),
    collectIds(getTopRatedMovies, SEO_TOP_RATED_PAGES),
    collectIds(getPopularTV, SEO_TITLE_PAGES),
    collectIds(getTopRatedTV, SEO_TOP_RATED_PAGES),
  ]);

  const movieIds = new Set<number>([...popularMovies, ...topMovies]);
  const tvIds = new Set<number>([...popularTV, ...topTV]);

  for (const id of movieIds) {
    entries.push({
      url: `${SITE_URL}/movie/${id}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }
  for (const id of tvIds) {
    entries.push({
      url: `${SITE_URL}/tv/${id}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  return entries;
}

/**
 * Person-URLs — speglar logiken i src/app/person/[id]/page.tsx.
 * Vi måste duplicera collectIds-pipelinen här (istället för att importera
 * generateStaticParams) eftersom Next inte exporterar generateStaticParams-
 * resultatet på ett sätt vi kan återanvända server-side i en annan route.
 */
async function personEntries(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  const pages = Array.from({ length: SEO_PERSON_SOURCE_MOVIE_PAGES }, (_, i) => i + 1);
  const popularResults = await Promise.allSettled(pages.map(p => getPopularMovies(p)));
  const movieIds = new Set<number>();
  for (const r of popularResults) {
    if (r.status === 'fulfilled') {
      for (const m of r.value.results) movieIds.add(m.id);
    }
  }

  const movieDetails = await Promise.allSettled(
    Array.from(movieIds).map(id => getMovie(id)),
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

  const ids = Array.from(peopleIds).slice(0, SEO_PERSON_TARGET_IDS);
  return ids.map(id => ({
    url: `${SITE_URL}/person/${id}/`,
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics = staticEntries();
  // Titles + persons kan failla oberoende av varandra (separata try-catch)
  // så att en TMDB-hick på person-credits inte tar ner hela title-sitemapen.
  const [titles, persons] = await Promise.all([
    titleEntries().catch(err => {
      console.warn('[sitemap] title-fetch misslyckades:', err);
      return [] as MetadataRoute.Sitemap;
    }),
    personEntries().catch(err => {
      console.warn('[sitemap] person-fetch misslyckades:', err);
      return [] as MetadataRoute.Sitemap;
    }),
  ]);
  return [...statics, ...titles, ...persons];
}
