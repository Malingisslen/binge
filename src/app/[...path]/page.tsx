import type { Metadata } from 'next';
import CatchAllClient from './CatchAllClient';

export function generateStaticParams() {
  return [{ path: ['_'] }];
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
export const metadata: Metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: 'https://binge.nu/' },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function CatchAllPage(props: { params: { path: string[] } }) {
  return <CatchAllClient />;
}
