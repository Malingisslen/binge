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
 * statiska HTML:en. Anledningen: prefix-omskrivningarna i firebase.json
 * skickar long-tail-URL:er hit med HTTP 200, även id:n som inte finns.
 *
 * Genom att sätta noindex här ärver alla long-tail routes (movie/tv/person,
 * /user/:u, /provider/:id, /list/:id, /grupper, /tillsammans) noindex i den
 * initiala HTML:en — innan JavaScript körs.
 *
 * Titlar och personer utanför det förrenderade urvalet förblir noindex även
 * efter hydrering (ADR 0024): klientsidorna sätter inte längre `indexable`.
 * Bara provider-sidorna i `SEO_PROVIDER_IDS` vänder till index.
 *
 * Förrenderade titlar påverkas inte: de har egna statiska HTML-filer
 * (out/movie/123/index.html) med egen metadata via generateMetadata.
 *
 * Ingen canonical i den statiska HTML:en. Root-layoutens `canonical: '/'` hade
 * annars följt med, och noindex ihop med "originalet är startsidan" är två
 * motstridiga besked om samma sida. usePageMeta sätter en egen canonical vid
 * hydrering.
 */
const BASE_METADATA: Metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: null },
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
