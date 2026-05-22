import type { MetadataRoute } from 'next';
import {
  getPopularMovies,
  getPopularTV,
  getTopRatedMovies,
  getTopRatedTV,
} from '@/lib/tmdb/client';

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
 *
 * Mål: ge Google en bred "kanonisk lista" av sidor vi anser viktiga, så att
 * indexerings-prioriteten inte tilldelas slumpvis via on-page crawl-discovery.
 *
 * Privata routes (/my, /settings, /stats, /grupper, /feed, /login,
 * /kalibrera) exkluderas eftersom de kräver auth. De har även
 * robots: index: false via sina layout.tsx-filer.
 *
 * Körs bara vid build — TMDB-calls här räknas mot byggtid inte runtime.
 * Om TMDB-calls failar (nätverk/rate-limit) faller sitemap tillbaka till
 * bara statiska routes istället för att bryta hela build:en.
 */

const SITE_URL = 'https://binge.nu';

// TMDB returnerar 20 titlar/page. För 2000 titlar/källa: 100 pages.
const POPULAR_PAGES = 100;
const TOP_RATED_PAGES = 100;

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
    collectIds(getPopularMovies, POPULAR_PAGES),
    collectIds(getTopRatedMovies, TOP_RATED_PAGES),
    collectIds(getPopularTV, POPULAR_PAGES),
    collectIds(getTopRatedTV, TOP_RATED_PAGES),
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics = staticEntries();
  try {
    const titles = await titleEntries();
    return [...statics, ...titles];
  } catch (err) {
    // Graceful degradation — TMDB nere vid build bryter inte deploy.
    console.warn('[sitemap] TMDB-fetch misslyckades, returnerar bara statics:', err);
    return statics;
  }
}
