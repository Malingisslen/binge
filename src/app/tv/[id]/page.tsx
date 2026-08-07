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
  SEO_FALLBACK_TV_IDS,
  cappedTitleIds,
  latinDisplayIds,
} from '@/lib/tmdb/seoCoverage';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { fetchForBuild, buildSignal, startBuildWatchdog, trackBuildCall } from '@/lib/tmdb/buildFetch';
import { buildContentFloor } from '@/lib/seo/contentFloor';
import { tvContentFloorInput } from '@/lib/seo/contentFloorInput';

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
  // BIN-815: den här fasen (`Collecting page data`) är den som hängde 4 av 6
  // körningar 2026-08-07. Pulsen startas innan första anropet och varje
  // list-hämtning registreras — utan det rapporterar vakthunden `inflight=0`
  // rakt igenom en hängning och pekar utredningen åt fel håll.
  startBuildWatchdog();
  const collectIds = async (
    fetcher: (page: number) => Promise<{ results: { id: number }[] }>,
    pageCount: number,
    kind: string,
  ): Promise<Set<number>> => {
    const ids = new Set<number>();
    const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
    const results = await Promise.allSettled(
      pages.map(p => trackBuildCall(`params:${kind}/p${p}`, () => fetcher(p))),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        // Curation: skip non-Latin-titled series — same rule as browsing
        // (titleFilter.ts); identical filter in sitemap.ts keeps parity.
        for (const id of latinDisplayIds(r.value.results)) ids.add(id);
      }
    }
    return ids;
  };

  try {
    const [popular, topRated] = await Promise.all([
      collectIds(p => getPopularTV(p, { signal: buildSignal() }), SEO_TITLE_PAGES, 'popular-tv'),
      collectIds(p => getTopRatedTV(p, { signal: buildSignal() }), SEO_TOP_RATED_PAGES, 'top-tv'),
    ]);
    const ids = cappedTitleIds([...popular], [...topRated]);
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
    // Content floor: real overview when substantive, else a generated Swedish
    // availability-first sentence — so empty-overview series are not thin.
    const description = buildContentFloor(tvContentFloorInput(show)).description;
    const url = `https://binge.nu/tv/${showId}/`;
    const image = show.poster_path ? posterUrl(show.poster_path, 'w500') : 'https://binge.nu/og-image.png';

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
