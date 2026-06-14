import { cache, Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import TVShowPageClient from '@/components/pages/TVShowPageClient';
import { LoadingView } from '@/components/ui/LoadingView';
import {
  getTVShow,
  getPopularTV,
  getTopRatedTV,
  posterUrl,
} from '@/lib/tmdb/client';
import {
  SEO_TITLE_PAGES,
  SEO_TOP_RATED_PAGES,
  SEO_TITLE_TARGET_IDS,
  SEO_FALLBACK_TV_IDS,
} from '@/lib/tmdb/seoCoverage';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { fetchForBuild, buildSignal } from '@/lib/tmdb/buildFetch';

export const dynamic = 'force-static';
export const dynamicParams = false;

/**
 * Pre-render topp-N populära + topp-rankade TV-serier som riktiga statiska
 * routes. Samma rationale som /movie/[id]/page.tsx — Googlebot får färdig
 * HTML med korrekt <title>, <meta>, <link rel="canonical"> och innehåll.
 *
 * Serier utanför topp-N hanteras via catch-all-routen + client-side rendering.
 *
 * Suspense-wrap krävs eftersom TVShowPageClient använder useSearchParams
 * (för `?fromGroup=`-parametern). Utan boundary failar Next-builden.
 *
 * Page-konstanterna delas med src/app/sitemap.ts via @/lib/tmdb/seoCoverage.
 */

const cachedGetTVShow = cache((id: number) => fetchForBuild('tv', getTVShow, id));

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const collectIds = async (
    fetcher: (page: number) => Promise<{ results: { id: number }[] }>,
    pageCount: number,
  ): Promise<Set<number>> => {
    const ids = new Set<number>();
    const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
    const results = await Promise.allSettled(pages.map(p => fetcher(p)));
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const item of r.value.results) {
          if (item.id) ids.add(item.id);
        }
      }
    }
    return ids;
  };

  try {
    const [popular, topRated] = await Promise.all([
      collectIds(p => getPopularTV(p, { signal: buildSignal() }), SEO_TITLE_PAGES),
      collectIds(p => getTopRatedTV(p, { signal: buildSignal() }), SEO_TOP_RATED_PAGES),
    ]);
    const merged = new Set<number>([...popular, ...topRated]);
    const ids = Array.from(merged).slice(0, SEO_TITLE_TARGET_IDS);
    // Tom lista (t.ex. CI utan giltig TMDB-nyckel) bryter Next 16:s static
    // export → fall tillbaka på en handfull välkända IDs så builden lyckas.
    const safe = ids.length > 0 ? ids : SEO_FALLBACK_TV_IDS;
    return safe.map(id => ({ id: String(id) }));
  } catch (err) {
    console.warn('[tv/[id]] generateStaticParams TMDB-fetch failed:', err);
    return SEO_FALLBACK_TV_IDS.map(id => ({ id: String(id) }));
  }
}

type PageParams = { id: string };

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { id } = await params;
  const showId = parseInt(id, 10);
  // Ogiltigt id → sidan kallar notFound() i body. Returnera noindex så den
  // aldrig ärver root-layoutens index:true + canonical:/ (homepage-dubblett).
  if (!Number.isFinite(showId)) return { robots: { index: false, follow: false } };

  try {
    const show = await cachedGetTVShow(showId);
    const displayTitle = preferOriginalTitle(show.name, show.original_name);
    const firstYear = show.first_air_date ? show.first_air_date.slice(0, 4) : '';
    const yearSuffix = firstYear ? ` (${firstYear})` : '';
    const overview = show.overview?.slice(0, 180) ?? '';
    const description = `${displayTitle}${yearSuffix}. ${overview}`.trim();
    const url = `https://binge.nu/tv/${showId}/`;
    const image = show.poster_path ? posterUrl(show.poster_path, 'w500') : 'https://binge.nu/og-image.svg';

    return {
      title: `${displayTitle}${yearSuffix} — var streamar jag?`,
      description,
      alternates: { canonical: url },
      openGraph: {
        title: `${displayTitle}${yearSuffix}`,
        description,
        url,
        siteName: 'Binge.nu',
        locale: 'sv_SE',
        type: 'video.tv_show',
        images: image ? [{ url: image, width: 500, height: 750, alt: displayTitle }] : undefined,
      },
      twitter: {
        card: 'summary_large_image',
        title: `${displayTitle}${yearSuffix}`,
        description,
        images: image ? [image] : undefined,
      },
    };
  } catch {
    // Build-time TMDB-hämtning misslyckades för denna förrenderade titel. Skicka
    // ALDRIG en indexerbar sida med root-layoutens default-title + canonical:/
    // (Google läser den som en homepage-dubblett). noindex + self-canonical tills
    // ett senare lyckat bygge fyller i riktig metadata; klient-hydrering via
    // usePageMeta sätter rätt title för besökare.
    return {
      title: 'Serie',
      robots: { index: false, follow: true },
      alternates: { canonical: `https://binge.nu/tv/${showId}/` },
    };
  }
}

export default async function TVPage({ params }: { params: Promise<PageParams> }) {
  const { id } = await params;
  const showId = parseInt(id, 10);
  if (!Number.isFinite(showId)) notFound();

  let initialData;
  try {
    initialData = await cachedGetTVShow(showId);
  } catch {
    initialData = undefined;
  }

  return (
    <Suspense fallback={<LoadingView label="Laddar serien…" />}>
      <TVShowPageClient id={id} initialData={initialData} />
    </Suspense>
  );
}
