import type { MetadataRoute } from 'next';
import { getPopularMovies, getPopularTV } from '@/lib/tmdb/client';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';

/**
 * Dynamisk sitemap som genereras vid `next build`.
 *
 * Inkluderar:
 * - Statiska offentliga routes (start, discover, films, series, calendar,
 *   recommendations, search, integritet, villkor, community-guidelines)
 * - Topp-N populära filmer + serier från TMDB (SE-region) — ger long-tail
 *   SEO för "var streamar jag X"-queries när användare söker specifika
 *   titlar
 *
 * Privata routes (/my, /settings, /stats, /grupper, /feed, /login,
 * /kalibrera) exkluderas eftersom de kräver auth. De har även
 * robots: index: false via sina layout.tsx-filer.
 *
 * Körs bara vid build — TMDB-calls här räknas mot byggtid inte runtime.
 * Om TMDB-calls failar (nätverk/rate-limit) faller sitemap tillbaka till
 * bara statiska routes istället för att brytna hela build:en.
 */

const SITE_URL = 'https://binge.nu';
const TOP_TITLES_PER_TYPE = 50; // Sitemap-limits: 50k URL:er; vi stannar under.

function staticEntries(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'daily', priority: 1.0 },
    { url: `${SITE_URL}/discover/`, lastModified, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/films/`, lastModified, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/series/`, lastModified, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/calendar/`, lastModified, changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE_URL}/recommendations/`, lastModified, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/savings/`, lastModified, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${SITE_URL}/integritet/`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/villkor/`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/community-guidelines/`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ];
  return entries;
}

async function popularTitleEntries(): Promise<MetadataRoute.Sitemap> {
  // Hämta parallellt — om en failar behåller vi den andra.
  const [moviesRes, tvRes] = await Promise.allSettled([
    getPopularMovies(1),
    getPopularTV(1),
  ]);

  const entries: MetadataRoute.Sitemap = [];
  const lastModified = new Date();

  if (moviesRes.status === 'fulfilled') {
    const results = moviesRes.value.results.slice(0, TOP_TITLES_PER_TYPE);
    for (const m of results) {
      entries.push({
        url: `${SITE_URL}/movie/${m.id}/`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  }

  if (tvRes.status === 'fulfilled') {
    const results = tvRes.value.results.slice(0, TOP_TITLES_PER_TYPE);
    for (const t of results) {
      entries.push({
        url: `${SITE_URL}/tv/${t.id}/`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  }

  return entries;
}

function providerPageEntries(): MetadataRoute.Sitemap {
  // Provider-specifika long-tail-pages finns inte idag, men blir naturligt
  // nästa steg (t.ex. /streaming/netflix/). Så länge vi inte har routen
  // returnerar vi inga entries här. Markören lämnas så vi minns att koppla
  // in den när /streaming/[provider]-pages byggs.
  return [];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics = staticEntries();
  try {
    const titles = await popularTitleEntries();
    return [...statics, ...titles, ...providerPageEntries()];
  } catch (err) {
    // Graceful degradation — TMDB nere vid build bryter inte deploy.
    // eslint-disable-next-line no-console
    console.warn('[sitemap] TMDB-fetch misslyckades, returnerar bara statics:', err);
    return [...statics, ...providerPageEntries()];
  }
}
