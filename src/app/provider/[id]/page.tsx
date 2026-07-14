import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ProviderPageClient from '@/components/pages/ProviderPageClient';
import { discoverMovies, discoverTV } from '@/lib/tmdb/client';
import { getProvider } from '@/lib/tmdb/providers';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';
import { buildSignal } from '@/lib/tmdb/buildFetch';
import { jsonLd } from '@/lib/seo/jsonLd';
import type { TMDBSearchResult } from '@/types';

export const dynamic = 'force-static';
export const dynamicParams = false;

/**
 * BIN-62 — indexerbara provider-landningssidor ("Streama på Netflix i Sverige").
 *
 * Den interaktiva browse-vyn (ProviderPageClient) fanns redan men serverades via
 * catch-all-skalet som `robots: noindex`, så den rankade aldrig. Här pre-renderas
 * en kurerad uppsättning (SEO_PROVIDER_IDS) som riktiga statiska routes med egen
 * title/description/canonical + ItemList/CollectionPage-JSON-LD — exakt samma
 * mönster som /movie/[id] + /tv/[id]. Provider-ids utanför listan faller fortsatt
 * till catch-all-klientrenderingen (noindex), precis som long-tail-titlar.
 *
 * Bara ~12 sidor → vi hämtar populära titlar direkt vid build (ingen
 * budget/cache-plumbing som titel-pre-rendren behöver för sina ~25k sidor).
 */

const SITE = 'https://binge.nu';

export function generateStaticParams(): { id: string }[] {
  return SEO_PROVIDER_IDS.map(id => ({ id: String(id) }));
}

type PageParams = { id: string };

function nameFor(pid: number): string | null {
  return getProvider(pid)?.name ?? null;
}

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { id } = await params;
  const pid = parseInt(id, 10);
  const name = nameFor(pid);
  // Okänd/ej-kurerad provider → noindex så den aldrig ärver root-layoutens
  // index:true + canonical:/ (homepage-dubblett).
  if (!name) return { robots: { index: false, follow: false }, alternates: { canonical: `${SITE}/provider/${pid}/` } };

  const title = `${name} — streama filmer och serier i Sverige`;
  const description = `Vad streamar på ${name} i Sverige? Populära filmer och serier på ${name}, nyheter och var du ser dem — spåra allt med Binge.`;
  const url = `${SITE}/provider/${pid}/`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Binge.nu', locale: 'sv_SE', type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

async function fetchPopular(pid: number): Promise<{ movies: TMDBSearchResult[]; tv: TMDBSearchResult[] }> {
  try {
    const [movies, tv] = await Promise.all([
      discoverMovies({ with_watch_providers: String(pid), sort_by: 'popularity.desc', page: '1' }, { signal: buildSignal() }),
      discoverTV({ with_watch_providers: String(pid), sort_by: 'popularity.desc', page: '1' }, { signal: buildSignal() }),
    ]);
    return { movies: movies.results ?? [], tv: tv.results ?? [] };
  } catch {
    // TMDB-hick vid build → klienten hämtar själv; sidan förblir grön.
    return { movies: [], tv: [] };
  }
}

export default async function ProviderPage({ params }: { params: Promise<PageParams> }) {
  const { id } = await params;
  const pid = parseInt(id, 10);
  const name = nameFor(pid);
  if (!name) notFound();

  const { movies, tv } = await fetchPopular(pid);
  const initialItems: TMDBSearchResult[] = movies.map(m => ({ ...m, media_type: 'movie' as const }));
  const url = `${SITE}/provider/${pid}/`;

  const itemListElement = [
    ...movies.slice(0, 12).map((m, i) => ({
      '@type': 'ListItem', position: i + 1,
      name: m.title || m.original_title || '', url: `${SITE}/movie/${m.id}/`,
    })),
    ...tv.slice(0, 8).map((t, i) => ({
      '@type': 'ListItem', position: 12 + i + 1,
      name: t.name || t.original_name || '', url: `${SITE}/tv/${t.id}/`,
    })),
  ].filter(e => e.name);

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Populärt på ${name} i Sverige`,
    url,
    itemListElement,
  };
  const collectionPage = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Streama på ${name} i Sverige`,
    description: `Populära filmer och serier på ${name} i Sverige.`,
    url,
    isPartOf: { '@type': 'WebSite', name: 'Binge.nu', url: `${SITE}/` },
  };

  return (
    <>
      {itemListElement.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(itemList) }} />
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionPage) }} />
      <ProviderPageClient id={id} initialTab="movies" initialItems={initialItems} />
    </>
  );
}
