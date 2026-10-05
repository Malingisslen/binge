import type { Metadata } from 'next';
import CatchAllClient from './CatchAllClient';
import { SHARE_SHELLS, shareShellFor } from '@/lib/seo/shareShells';

const SITE_URL = 'https://binge.nu';

// `_` är det allmänna skalet. Varje delningsbart prefix får dessutom ett eget skal
// (out/tillsammans/_/index.html …) med egen förhandsvisning — se shareShells.ts.
export function generateStaticParams() {
  return [{ path: ['_'] }, ...SHARE_SHELLS.map((s) => ({ path: [s.prefix, '_'] }))];
}

/**
 * Catch-all-routens metadata sätter noindex som *defensiv default* i den
 * statiska HTML:en. Anledningen: Firebase rewrite `** → /_/index.html`
 * skickar ALLA okända URLs hit och returnerar HTTP 200, vilket gör att
 * Google tidigare indexerade tusentals soft-404:s som dubletter.
 *
 * Genom att sätta noindex här ärver alla long-tail routes (movie/tv/person
 * utanför topp-N, /user/:u, /provider/:id, /list/:id, /grupper, /tillsammans,
 * helt okända paths) noindex i den initiala HTML:en — innan JavaScript körs.
 *
 * För long-tail movie/tv/person *som har giltig data* tar
 * MoviePageClient/TVShowPageClient/PersonPageClient bort noindex via
 * usePageMeta({ indexable: true }) efter att TMDB-fetchen lyckats. Det ger
 * Googlebot's andra crawl-fas (JS-rendering) signalen att den specifika
 * URL:en faktiskt får indexeras.
 *
 * Sociala/personliga routes (/user, /grupper, /tillsammans, /list) sätter
 * INTE indexable: true → de förblir noindex, vilket är önskat för privacy.
 *
 * Pre-renderade routes (movie/tv/person i topp-N) påverkas inte alls
 * eftersom de har egna statiska HTML-filer (out/movie/123/index.html) med
 * egen metadata via generateMetadata.
 */
const BASE_METADATA: Metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: 'https://binge.nu/' },
};

export async function generateMetadata({ params }: { params: Promise<{ path: string[] }> }): Promise<Metadata> {
  const { path } = await params;
  const shell = path.length > 1 ? shareShellFor(path[0]) : undefined;
  if (!shell) return BASE_METADATA;
  const image = { url: `${SITE_URL}${shell.image}`, width: 1200, height: 630, alt: shell.imageAlt };
  return {
    ...BASE_METADATA,
    title: { absolute: shell.title },
    description: shell.description,
    openGraph: {
      title: shell.title,
      description: shell.description,
      siteName: 'Binge.nu',
      type: 'website',
      locale: 'sv_SE',
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: shell.title, description: shell.description, images: [image.url] },
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function CatchAllPage(props: { params: { path: string[] } }) {
  return <CatchAllClient />;
}
