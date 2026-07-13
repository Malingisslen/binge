import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { discoverMovies, discoverTV, posterUrl } from '@/lib/tmdb/client';
import { GENRE_HUBS, genreHubBySlug, type GenreHub } from '@/lib/seo/genreHubs';
import type { TMDBSearchResult } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import JustWatchCredit from '@/components/ui/JustWatchCredit';

export const dynamic = 'force-static';
export const dynamicParams = false;

/**
 * BIN-461 — indexerbara genre-landningssidor ("Bästa thrillers att streama i
 * Sverige"). Samma recept som /billigaste (BIN-178): kurerad slug-mängd, ren
 * pre-render, ingen DynamicRouter/klient-fallback. Okänd slug har ingen
 * exporterad fil — hostingens `**`-rewrite serverar då SPA-skalet (200,
 * noindex by default), inte en äkta 404; noindex-grenen i generateMetadata
 * täcker dev-läget och är skyddsnät om hostingbeteendet ändras.
 *
 * Build-data: EN discover-fråga per medium direkt via discoverMovies/discoverTV
 * (PE-villkor: ALDRIG via fetchForBuild — dess cache/budget är id-nycklad för
 * 25k-titelpipelinen; query-formade anrop hör inte hemma där). Zero-rader
 * (flakad build-fetch) skeppar en resilient "kommer snart"-EmptyState istället
 * för notFound() — URL:en ligger redan i sitemapen (BIN-460-läxan).
 */

const SITE = 'https://binge.nu';

/** Visade titlar per sektion (JSON-LD listar färre — samma tak som /provider). */
const SECTION_CAP = 12;

export function generateStaticParams(): { slug: string }[] {
  return GENRE_HUBS.map((g) => ({ slug: g.slug }));
}

type PageParams = { slug: string };

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { slug } = await params;
  const hub = genreHubBySlug(slug);
  // Okänd slug → noindex så den aldrig ärver root-layoutens index:true + canonical:/.
  if (!hub) return { robots: { index: false, follow: false }, alternates: { canonical: `${SITE}/genre/${slug}/` } };

  const url = `${SITE}/genre/${hub.slug}/`;
  return {
    title: hub.metaTitle,
    description: hub.metaDescription,
    alternates: { canonical: url },
    openGraph: { title: hub.metaTitle, description: hub.metaDescription, url, siteName: 'Binge.nu', locale: 'sv_SE', type: 'website' },
    twitter: { card: 'summary_large_image', title: hub.metaTitle, description: hub.metaDescription },
  };
}

function jsonLd(data: Record<string, unknown>): string {
  // "<" → < så en titel med "</script>" aldrig bryter ut ur blocket.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

// Build-time TMDB fetches flake intermittently under the 25k-page export's
// concurrency (same failure mode as /billigaste). Retry per anrop med liten
// backoff; buildSignal() skapas per försök (en timad-ut signal kan inte
// återanvändas). En flakad TV-fetch får inte köra om en lyckad film-fetch —
// därför retry PER CALL, inte per sida (PE-villkor).
async function withRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // 700ms-steg (totalt ~7s över 5 försök): flake-stormen vid exportstart
      // överlevde billigaste-mönstrets 300ms-steg — dessa sidor gör bara 1
      // anrop var, så en längre svans kostar sekunder, inte byggminuter.
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw lastErr;
}

// with_watch_monetization_types + watch_region=SE (klientens default) filtrerar
// till titlar med NÅGOT svenskt erbjudande — utan det är listan global popularitet
// och sidans löfte "att streama i Sverige" håller inte för toppositionerna.
const DISCOVER_PARAMS = {
  sort_by: 'popularity.desc',
  'vote_count.gte': '50',
  with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
  page: '1',
};

// Per-försök-timeout: 5 försök × 8s + ~7s backoff ≈ 47s värsta fall — under
// Nexts 60s-tak för statisk sidgenerering. buildSignal():s 20s är kalibrerad
// för 1-försöks-anrop; i en 5-stegs retrystege skulle den kunna nå ~107s och
// döda hela exporten om TMDB hänger istället för att snabb-refusera.
const ATTEMPT_TIMEOUT_MS = 8_000;
const attemptSignal = (): AbortSignal => AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);

// "fetch failed" är bara undicis omslag — grundorsaken (ECONNRESET/EAI_AGAIN/…)
// ligger i e.cause, ibland som AggregateError med tomt message men med .code.
// Utan den är ett byggfel odiagnostiserbart i CI-loggen.
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts = [e.message];
  const cause = e.cause;
  if (cause instanceof AggregateError) {
    parts.push(...cause.errors.map((x) => (x instanceof Error ? `${(x as NodeJS.ErrnoException).code ?? ''} ${x.message}`.trim() : String(x))));
  } else if (cause instanceof Error) {
    parts.push(`${(cause as NodeJS.ErrnoException).code ?? ''} ${cause.message}`.trim());
  }
  return parts.filter(Boolean).join(' / ');
}

async function fetchGenre(hub: GenreHub): Promise<{ movies: TMDBSearchResult[]; tv: TMDBSearchResult[] }> {
  // Film + serie parallellt (PE-villkor) — en rundresa i byggtid, inte två.
  const [movies, tv] = await Promise.all([
    hub.movieGenreId == null
      ? Promise.resolve<TMDBSearchResult[]>([])
      : withRetry(
          () => discoverMovies({ ...DISCOVER_PARAMS, with_genres: String(hub.movieGenreId) }, { signal: attemptSignal() }),
          5,
        ).then((r) => r.results ?? []).catch((e) => {
          console.warn(`[genre] ${hub.slug}: movie discover failed after retries — ${describeError(e)}`);
          return [];
        }),
    hub.tvGenreId == null
      ? Promise.resolve<TMDBSearchResult[]>([])
      : withRetry(
          () => discoverTV({ ...DISCOVER_PARAMS, with_genres: String(hub.tvGenreId) }, { signal: attemptSignal() }),
          5,
        ).then((r) => r.results ?? []).catch((e) => {
          console.warn(`[genre] ${hub.slug}: tv discover failed after retries — ${describeError(e)}`);
          return [];
        }),
  ]);
  return { movies, tv };
}

interface Row {
  id: number;
  title: string;
  year: string | null;
  posterPath: string | null;
  href: string;
}

function toRows(items: TMDBSearchResult[], kind: 'movie' | 'tv'): Row[] {
  return items
    .map((x) => ({
      id: x.id,
      title: (kind === 'movie' ? x.title || x.original_title : x.name || x.original_name) ?? '',
      year: (kind === 'movie' ? x.release_date : x.first_air_date)?.slice(0, 4) || null,
      posterPath: x.poster_path ?? null,
      href: `/${kind}/${x.id}/`,
    }))
    .filter((r) => r.title)
    .slice(0, SECTION_CAP);
}

function TitleRows({ rows }: { rows: Row[] }) {
  return (
    <ol className="grid sm:grid-cols-2 gap-2 mb-6">
      {rows.map((r) => {
        const poster = posterUrl(r.posterPath, 'w92');
        return (
          <li key={r.href}>
            <Link href={r.href} className="flex items-center gap-3 bg-surface rounded p-2 border border-rule hover:shadow-lift transition-shadow">
              {poster ? (
                <img src={poster} alt="" width={46} height={69} loading="lazy" decoding="async" className="rounded-sm shrink-0" />
              ) : (
                <div className="w-[46px] h-[69px] rounded-sm bg-bg-2 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-base font-medium text-ink truncate">
                  {r.title}{r.year ? <span className="text-ink-3 font-normal"> ({r.year})</span> : null}
                </div>
                <div className="text-sm text-ink-2">Se var den streamar</div>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export default async function GenrePage({ params }: { params: Promise<PageParams> }) {
  const { slug } = await params;
  const hub = genreHubBySlug(slug);
  if (!hub) notFound();

  const { movies, tv } = await fetchGenre(hub);
  const movieRows = toRows(movies, 'movie');
  const tvRows = toRows(tv, 'tv');
  const url = `${SITE}/genre/${hub.slug}/`;

  const collectionPage = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: hub.h1,
    description: hub.metaDescription,
    url,
    isPartOf: { '@type': 'WebSite', name: 'Binge.nu', url: `${SITE}/` },
  };

  // Zero rader totalt = flakad build-fetch (URL:en är redan sitemap-committad) →
  // resilient 200 med designat tomläge, fylls på vid nästa build (BIN-460).
  if (movieRows.length === 0 && tvRows.length === 0) {
    return (
      <div className="canvas">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionPage) }} />
        <PageHeader crumb="Genreguide" title={hub.h1} standfirst={hub.blurb} />
        <EmptyState
          title={`${hub.label} — listan uppdateras`}
          body="Vi hämtar just nu in vad som streamar i Sverige inom genren. Titta in snart — sidan fylls på så fort datan är klar."
          action={<Link href="/guider/" className="btn btn-acc btn-sm">Utforska fler streamingguider</Link>}
        />
        <div className="mt-6">
          <JustWatchCredit />
        </div>
      </div>
    );
  }

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: hub.h1,
    url,
    itemListElement: [...movieRows, ...tvRows].map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: r.year ? `${r.title} (${r.year})` : r.title,
      url: `${SITE}${r.href}`,
    })),
  };

  return (
    <div className="canvas">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionPage) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(itemList) }} />

      <PageHeader crumb="Genreguide" title={hub.h1} standfirst={hub.blurb} />

      {movieRows.length > 0 && (
        <section>
          <h2 className="text-[15px] font-semibold text-ink uppercase tracking-wide mb-2">Filmer</h2>
          <TitleRows rows={movieRows} />
        </section>
      )}

      {tvRows.length > 0 && (
        <section>
          <h2 className="text-[15px] font-semibold text-ink uppercase tracking-wide mb-2">Serier</h2>
          <TitleRows rows={tvRows} />
        </section>
      )}

      <p className="text-sm text-ink-2 max-w-[62ch] mb-4">
        Öppna en titel för att se exakt vilka tjänster som har den — i abonnemang, gratis eller att hyra —
        och lägg den i din lista så håller Binge koll på var den går att se.
      </p>

      <JustWatchCredit />
    </div>
  );
}
