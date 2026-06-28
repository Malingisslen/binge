import type { MetadataRoute } from 'next';
import {
  getPopularMovies,
  getPopularTV,
  getTopRatedMovies,
  getTopRatedTV,
} from '@/lib/tmdb/client';
import {
  SEO_TITLE_PAGES,
  SEO_TOP_RATED_PAGES,
  SEO_PROVIDER_IDS,
  cappedTitleIds,
} from '@/lib/tmdb/seoCoverage';
import { collectPersonIds } from '@/lib/tmdb/seoPersonIds';
import { FRANCHISES } from '@/lib/seo/franchises';

// Next 16 + output:'export' kräver explicit static/revalidate-deklaration
// för Metadata-routes. Vi vill att sitemap:en genereras en gång vid build
// och sedan är en statisk fil i out/.
export const dynamic = 'force-static';

/**
 * Dynamisk sitemap som genereras vid `next build`.
 *
 * Inkluderar:
 * - Statiska offentliga routes (start, discover, films, series,
 *   integritet, villkor, community-guidelines)
 *
 * /savings/ är INTE med (BIN-305): den är auth-gated — crawlers får bara en
 * spinner (tunt/soft-404-innehåll). Den bär istället robots:noindex via sin
 * layout.tsx. Vi Disallow:ar den dock INTE i robots.txt — en blockerad URL kan
 * aldrig crawlas för att SE noindex-direktivet, så noindex + crawlbar är rätt
 * kombination för att hålla den ur indexet.
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

  // Cap + dedup via cappedTitleIds — EXAKT samma id-mängd som pre-rendren i
  // movie/[id]/page.tsx + tv/[id]/page.tsx. En enda källa för merge-ordning,
  // dedup och cap; utan delad helper kan sitemap adressera fler URLs än som
  // pre-renderas → "Genomsökt – inte indexerad" i GSC.
  const movieIds = cappedTitleIds([...popularMovies], [...topMovies]);
  const tvIds = cappedTitleIds([...popularTV], [...topTV]);

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
 * Person-URLs — delar EXAKT samma pipeline som src/app/person/[id]/page.tsx
 * via collectPersonIds (@/lib/tmdb/seoPersonIds), så sitemap och pre-render
 * adresserar samma person-URL-mängd. Sitemap:en hoppar över buildSignal +
 * ≥1-fallbacken (en tom person-lista är ok i en sitemap; fallbacken behövs
 * bara för Next static-export-kravet i generateStaticParams).
 */
async function personEntries(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const ids = await collectPersonIds();
  return ids.map(id => ({
    url: `${SITE_URL}/person/${id}/`,
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));
}

// Provider-landningssidor (BIN-62) — MÅSTE matcha generateStaticParams i
// src/app/provider/[id]/page.tsx (samma SEO_PROVIDER_IDS) så sitemap och
// pre-render adresserar exakt samma URL-mängd. Inga TMDB-calls (statisk lista).
function providerEntries(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return SEO_PROVIDER_IDS.map(id => ({
    url: `${SITE_URL}/provider/${id}/`,
    lastModified,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));
}

// "Billigaste sättet att se hela [franchise]" (BIN-178) — MÅSTE matcha
// generateStaticParams i src/app/billigaste/[slug]/page.tsx (samma FRANCHISES).
function franchiseEntries(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return FRANCHISES.map(f => ({
    url: `${SITE_URL}/billigaste/${f.slug}/`,
    lastModified,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));
}

// "Vad försvinner från [provider]" (BIN-178) — MÅSTE matcha generateStaticParams
// i src/app/forsvinner/[id]/page.tsx (samma SEO_PROVIDER_IDS). Innehållet
// uppdateras dagligen (klient-läst rollup) → daily changeFrequency.
function forsvinnerEntries(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return SEO_PROVIDER_IDS.map(id => ({
    url: `${SITE_URL}/forsvinner/${id}/`,
    lastModified,
    changeFrequency: 'daily' as const,
    priority: 0.7,
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
  return [...statics, ...providerEntries(), ...franchiseEntries(), ...forsvinnerEntries(), ...titles, ...persons];
}
