'use client';

import { useState, type CSSProperties } from 'react';
import { useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import { Check, Plus } from 'lucide-react';
import ClientOnly from '@/components/utils/ClientOnly';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { getMovieLite, posterUrl, titleHref } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import {
  summarizeCollectionStreaming,
  seFlatrateProviderIds,
  streamingSummaryText,
} from '@/lib/collection/streamingSummary';
import { companionsFor, type CompanionTitle } from '@/lib/franchise/companions';
import type { TMDBMovie } from '@/types';

/**
 * Cross-type franchise link: a TV series that continues as a film (Breaking Bad →
 * El Camino), and vice versa. Sourced from the hand-curated src/lib/franchise/
 * companions.ts — TMDB models no such relationship (see that file's header).
 *
 * Crawlability + enrichment without a duplicate render: the crawlable link strip is
 * ClientOnly's FALLBACK, so it lands in the static export HTML (what Googlebot sees);
 * after hydration the enriched grid (posters, seen-state, "var streamar den", "lägg i
 * vill se") swaps in. The watchlist/auth/query hooks live only in the enriched child,
 * so they never run during static export — zero export risk. Renders nothing for the
 * ~99% of titles that aren't mapped.
 *
 * "Link, not merge" — the show and the film stay separate library documents; this only
 * shows the path between them (same decision as the Doctor Who split-franchise strip).
 */
export default function CompanionSection({
  anchorMediaType,
  anchorId,
}: {
  anchorMediaType: 'movie' | 'tv';
  anchorId: number;
}) {
  const companions = companionsFor(anchorMediaType, anchorId);
  if (companions.length === 0) return null;

  const hasSeries = companions.some((c) => c.mediaType === 'tv');
  const hasFilms = companions.some((c) => c.mediaType === 'movie');

  return (
    <section className="detail-section" style={{ borderTop: '1px solid var(--rule)', paddingTop: 28 }}>
      <div className="head">
        <h2>{companionHeading(anchorMediaType, hasSeries, hasFilms)}</h2>
      </div>
      <ClientOnly fallback={<ChipRow items={companions} />}>
        <CompanionEnriched companions={companions} />
      </ClientOnly>
    </section>
  );
}

/**
 * Heading derived from what's actually shown, not just the anchor's type — a movie
 * anchor can return the source show PLUS sibling films (X-Files, SATC, Downton Abbey),
 * so "Bygger på serien" would mislabel those. Kept robust for future groups too.
 */
function companionHeading(anchor: 'movie' | 'tv', hasSeries: boolean, hasFilms: boolean): string {
  if (anchor === 'tv') {
    // From a show: normally its follow-up film(s); "samma serie" if another show is grouped in.
    return hasSeries ? 'Samma serie' : 'Fortsätter som film';
  }
  // From a film:
  if (hasSeries && hasFilms) return 'Del av samma serie'; // source show + sibling films
  if (hasSeries) return 'Bygger på serien';
  return 'Relaterade filmer';
}

/**
 * Crawlable chip row — plain title links, no fetch. Used both as the ClientOnly
 * fallback (server HTML / pre-hydration) and for the series companions in the enriched
 * layer, so the markup + key scheme live in one place.
 */
function ChipRow({ items, style }: { items: CompanionTitle[]; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, ...style }}>
      {items.map((c) => (
        <Link
          key={`${c.mediaType}_${c.id}`}
          href={titleHref(c.mediaType, c.id)}
          className="chip transition-colors hover:border-ink"
          style={{ textDecoration: 'none' }}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Enriched layer (post-hydration only). Series companions stay as chips (you follow a
 * show on its own page); film companions get a poster card with seen-state + a "lägg i
 * vill se" shortcut, and a shared "var streamar den" summary computed from the same
 * lite fetch (no extra call — companion groups are tiny, so unlike CollectionSection
 * there is no need to gate the fetch on expand).
 */
function CompanionEnriched({ companions }: { companions: CompanionTitle[] }) {
  const films = companions.filter((c) => c.mediaType === 'movie');
  const series = companions.filter((c) => c.mediaType === 'tv');
  const { getItem, addItem } = useWatchlist();
  const { user } = useAuth();
  const [showStreaming, setShowStreaming] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);

  const liteQueries = useQueries({
    queries: films.map((c) => ({
      queryKey: ['movie-lite', c.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getMovieLite(c.id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });

  // One watchlist lookup per film (getItem is an O(watchlist) scan), reused everywhere
  // below instead of re-scanning for seen/in-library at each site.
  const filmRows = films.map((film, i) => {
    const item = getItem('movie', film.id);
    return {
      film,
      movie: liteQueries[i]?.data as TMDBMovie | undefined,
      seen: item?.status === 'sedd',
      inLibrary: !!item,
    };
  });

  // Streaming availability for the UNSEEN films, reusing the collection summarizer.
  const unseenProviderRows = filmRows
    .filter((r) => !r.seen && !!r.movie)
    .map((r) => ({ tmdbId: r.film.id, providerIds: seFlatrateProviderIds(r.movie) }));
  const streamSummary = summarizeCollectionStreaming(unseenProviderRows, user?.myProviders ?? []);
  const unseenCount = filmRows.filter((r) => !r.seen).length;
  // Guard the post-hydration window before the lite queries resolve: without this,
  // `considered === 0` would render the false-negative "ingen tillgänglighet" instead
  // of a loading state (mirrors CollectionSection's streamingLoading branch).
  const streamingLoading = liteQueries.some((q) => q.isLoading);

  async function addOne(film: CompanionTitle, movie: TMDBMovie) {
    if (addingId != null || getItem('movie', film.id)) return;
    setAddingId(film.id);
    try {
      await addItem({
        tmdbId: film.id,
        mediaType: 'movie',
        status: 'vill_se',
        title: preferOriginalTitle(movie.title, movie.original_title) || movie.title || film.label,
        posterPath: movie.poster_path ?? null,
        releaseYear: movie.release_date ? parseInt(movie.release_date.slice(0, 4), 10) || null : null,
        rating: null,
        notes: null,
        totalSeasons: null,
        lastWatchedSeason: null,
        lastWatchedEpisode: null,
        providers: [],
        genreIds: movie.genres?.map((g) => g.id) ?? [],
        tmdbStatus: null,
      });
    } finally {
      setAddingId(null);
    }
  }

  return (
    <>
      {series.length > 0 && (
        <ChipRow items={series} style={{ marginBottom: films.length > 0 ? 16 : 0 }} />
      )}

      {films.length > 0 && unseenCount > 0 && (
        <div style={{ marginBottom: 14 }}>
          <button
            onClick={() => setShowStreaming((s) => !s)}
            className="btn btn-ghost btn-sm"
            aria-expanded={showStreaming}
          >
            {showStreaming ? 'Dölj tillgänglighet' : 'Var streamar den?'}
          </button>
          {showStreaming && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-2)' }}>
              {streamingLoading ? (
                <span className="text-ink-3">Hämtar tillgänglighet…</span>
              ) : streamSummary.considered === 0 ? (
                <span className="text-ink-3">Ingen abonnemangstillgänglighet hittad i Sverige.</span>
              ) : (
                <span>{streamingSummaryText(streamSummary)}</span>
              )}
              {!streamingLoading && streamSummary.withAnyProvider > 0 && (
                <div style={{ marginTop: 6 }}><JustWatchCredit /></div>
              )}
            </div>
          )}
        </div>
      )}

      {films.length > 0 && (
        <div className="similar-grid">
          {filmRows.map(({ film, movie, seen, inLibrary }) => {
            const poster = movie ? posterUrl(movie.poster_path, 'w342') : null;
            const title = movie
              ? preferOriginalTitle(movie.title, movie.original_title) || movie.title || film.label
              : film.label;
            const year = movie?.release_date ? movie.release_date.slice(0, 4) : '';
            return (
              <div key={`movie_${film.id}`}>
                <Link
                  href={titleHref('movie', film.id)}
                  style={{ textDecoration: 'none', color: 'inherit', position: 'relative', display: 'block' }}
                >
                  <div className="poster" style={{ opacity: seen ? 0.55 : 1 }}>
                    {poster && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={poster} alt={title} loading="lazy" decoding="async" width={342} height={513} />
                    )}
                    {seen && (
                      <span
                        title="Sedd"
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          width: 22, height: 22, borderRadius: 999,
                          background: 'var(--acc-deep)', color: 'white',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Check size={13} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, marginTop: 6, lineHeight: 1.25 }}>{title}</div>
                  {year && <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1 }}>{year}</div>}
                </Link>
                {movie && !inLibrary && (
                  <button
                    onClick={() => addOne(film, movie)}
                    disabled={addingId != null}
                    className="btn btn-ghost btn-sm inline-flex items-center gap-1"
                    style={{ marginTop: 6 }}
                  >
                    <Plus size={12} />
                    Lägg i vill se
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
