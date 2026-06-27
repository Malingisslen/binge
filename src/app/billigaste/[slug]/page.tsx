import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCollection, getMovieLite, posterUrl } from '@/lib/tmdb/client';
import { FRANCHISES, franchiseBySlug } from '@/lib/seo/franchises';
import { franchisePlan, type FranchiseFilm } from '@/lib/seo/franchiseCheapest';
import { canonicalProviderId, getProvider } from '@/lib/tmdb/providers';
import { fetchForBuild } from '@/lib/tmdb/buildFetch';
import type { TMDBCollectionPart } from '@/types/tmdb';
import { PageHeader } from '@/components/layout/PageHeader';
import JustWatchCredit from '@/components/ui/JustWatchCredit';

export const dynamic = 'force-static';
export const dynamicParams = false;

/**
 * BIN-178 — "Billigaste sättet att se hela [franchise]". Real pre-rendered
 * static routes (the BIN-62 pattern — catch-all client pages don't index
 * reliably). One indexable page per curated TMDB collection: which single
 * subscription covers the most of the franchise + what's left to rent.
 *
 * Build-time data only: TMDB collection parts + per-film SE watch/providers
 * (flatrate/free/rent/buy LISTS — TMDB has no rent PRICES, those are MOTN/
 * runtime). So we never print a rent amount; each film links to its title page
 * for the live price. JustWatch attribution required on this provider surface.
 */

const SITE = 'https://binge.nu';

export function generateStaticParams(): { slug: string }[] {
  return FRANCHISES.map((f) => ({ slug: f.slug }));
}

type PageParams = { slug: string };

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { slug } = await params;
  const franchise = franchiseBySlug(slug);
  // Okänd slug → noindex så den aldrig ärver root-layoutens index:true + canonical:/.
  if (!franchise) return { robots: { index: false, follow: false }, alternates: { canonical: `${SITE}/billigaste/${slug}/` } };

  const title = `Billigaste sättet att se hela ${franchise.name} i Sverige`;
  const description = `Var streamar ${franchise.name}? Vilken tjänst som täcker flest filmer, vad du behöver hyra och billigaste vägen att se hela ${franchise.name} i Sverige — uppdaterat på Binge.`;
  const url = `${SITE}/billigaste/${franchise.slug}/`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Binge.nu', locale: 'sv_SE', type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

interface FilmRow extends FranchiseFilm {
  posterPath: string | null;
  /** canonical sub provider ids the film is on (for display). */
  canonicalSubs: number[];
}

function providerNames(ids: number[]): string {
  const seen = new Set<number>();
  const names: string[] = [];
  for (const raw of ids) {
    const cid = canonicalProviderId(raw);
    if (seen.has(cid)) continue;
    seen.add(cid);
    const p = getProvider(cid);
    if (p) names.push(p.shortName || p.name);
  }
  return names.join(', ');
}

export default async function BilligastePage({ params }: { params: Promise<PageParams> }) {
  const { slug } = await params;
  const franchise = franchiseBySlug(slug);
  if (!franchise) notFound();

  let parts: TMDBCollectionPart[] = [];
  try {
    const collection = await fetchForBuild('collection', getCollection, franchise.collectionId);
    parts = collection.parts ?? [];
  } catch {
    parts = [];
  }

  const today = new Date().toISOString().slice(0, 10);
  const released = parts
    .filter((p) => (p.title || p.original_title) && p.release_date && p.release_date <= today)
    .sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''));

  const rows: FilmRow[] = [];
  for (const p of released) {
    let se;
    try {
      const movie = await fetchForBuild('movie-lite', getMovieLite, p.id);
      se = movie['watch/providers']?.results?.SE;
    } catch {
      se = undefined;
    }
    const subRaw = [...(se?.flatrate ?? []), ...(se?.free ?? [])].map((x) => x.provider_id);
    rows.push({
      tmdbId: p.id,
      title: p.title || p.original_title || '',
      year: p.release_date ? p.release_date.slice(0, 4) : null,
      subscriptionProviderIds: subRaw,
      rentable: !!(se?.rent?.length || se?.buy?.length),
      posterPath: p.poster_path,
      canonicalSubs: [...new Set(subRaw.map(canonicalProviderId))],
    });
  }

  if (rows.length === 0) notFound();

  const plan = franchisePlan(rows);
  const url = `${SITE}/billigaste/${franchise.slug}/`;
  const best = plan.bestProviderId != null ? getProvider(plan.bestProviderId) : null;

  const verdict = best
    ? `${best.name}${best.defaultMonthlyCost ? ` (${best.defaultMonthlyCost} kr/mån)` : ''} täcker ${plan.coveredCount} av ${plan.totalFilms} ${plan.totalFilms === 1 ? 'film' : 'filmer'}`
    : `Ingen enskild streamingtjänst täcker ${franchise.name} i Sverige just nu`;
  const remainderLine = [
    plan.rentCount > 0 ? `${plan.rentCount} att hyra eller köpa` : '',
    plan.unavailableCount > 0 ? `${plan.unavailableCount} saknas i Sverige` : '',
  ].filter(Boolean).join(' · ');

  const collectionPage = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Billigaste sättet att se hela ${franchise.name} i Sverige`,
    description: `Var och hur du ser hela ${franchise.name} billigast i Sverige.`,
    url,
    isPartOf: { '@type': 'WebSite', name: 'Binge.nu', url: `${SITE}/` },
  };
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${franchise.name} — filmer i ordning`,
    url,
    itemListElement: rows.map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: r.year ? `${r.title} (${r.year})` : r.title,
      url: `${SITE}/movie/${r.tmdbId}/`,
    })),
  };

  return (
    <div className="canvas">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionPage) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(itemList) }} />

      <PageHeader
        crumb="Billigaste vägen"
        title={`Se hela ${franchise.name} — billigast i Sverige`}
        standfirst={`${plan.totalFilms} ${plan.totalFilms === 1 ? 'film' : 'filmer'}. Vilken tjänst som täcker flest, vad du behöver hyra, och var du ser resten.`}
      />

      <section className="surface rounded-lg p-4 mb-5 border border-rule">
        <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">Billigaste vägen</div>
        <div className="text-[17px] font-semibold text-ink">{verdict}</div>
        {remainderLine && <div className="text-base text-ink-2 mt-1">{remainderLine}</div>}
        <div className="text-xs text-ink-3 mt-2">
          Exakta hyrpriser varierar — öppna en filmsida för det aktuella priset och länk till tjänsten.
        </div>
      </section>

      <ol className="flex flex-col gap-2 mb-6">
        {rows.map((r) => {
          const onPlan = plan.bestProviderId != null && r.canonicalSubs.includes(plan.bestProviderId);
          let status: string;
          if (onPlan && best) status = `Ingår i ${best.shortName || best.name}`;
          else if (r.canonicalSubs.length > 0) status = `Streamas på ${providerNames(r.canonicalSubs)}`;
          else if (r.rentable) status = 'Hyr eller köp';
          else status = 'Saknas i Sverige';
          const poster = posterUrl(r.posterPath, 'w92');
          return (
            <li key={r.tmdbId}>
              <Link href={`/movie/${r.tmdbId}/`} className="flex items-center gap-3 surface rounded p-2 border border-rule hover:shadow-lift transition-shadow">
                {poster ? (
                  <img src={poster} alt="" width={46} height={69} loading="lazy" decoding="async" className="rounded-sm shrink-0" />
                ) : (
                  <div className="w-[46px] h-[69px] rounded-sm bg-bg-2 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-base font-medium text-ink truncate">
                    {r.title}{r.year ? <span className="text-ink-3 font-normal"> ({r.year})</span> : null}
                  </div>
                  <div className={`text-sm ${onPlan ? 'text-acc-deep' : 'text-ink-2'}`}>{status}</div>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

      <JustWatchCredit />
      <span className="text-ink-3 text-[11px]">{' · '}Tillgänglighet via Movie of the Night · Data från TMDB</span>
    </div>
  );
}
