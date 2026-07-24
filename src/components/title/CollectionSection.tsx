'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { useCollection } from '@/hooks/useTMDB';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { getMovieLite } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import SeenPosterCard from '@/components/title/SeenPosterCard';
import { buildWatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { summarizeCollectionStreaming, seFlatrateProviderIds, streamingSummaryText } from '@/lib/collection/streamingSummary';

/**
 * BIN-94 — franchise/collection completion tracking + BIN-135 streaming-summary.
 *
 * När en film hör till en TMDB-samling (belongs_to_collection) listar vi hela
 * samlingen med varje films sett/osett-läge (korsrefererat mot biblioteket) och
 * en "lägg till alla osedda i vill se"-genväg. En query per samling (useCollection).
 *
 * BIN-135: "var streamar de osedda" är LAT — providers hämtas bara när användaren
 * expanderar (de flesta vyer = noll extra anrop), bara för osedda, capat till
 * STREAM_CAP, och via den delade ['movie-lite', id]-cachen (TMDB_STALE.LITE_DETAIL)
 * så varje titel hämtas högst en gång per session och delas med kalender/rådgivare.
 */

const STREAM_CAP = 12;
const ADD_UNSEEN_CAP = 50;

export default function CollectionSection({
  collectionId,
  currentMovieId,
}: {
  collectionId: number;
  currentMovieId: number;
}) {
  const { data: collection } = useCollection(collectionId);
  const { getItem, addItem, loading: watchlistLoading } = useWatchlist();
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showStreaming, setShowStreaming] = useState(false);
  useEffect(() => setMounted(true), []);

  // Sortera kronologiskt — samlingar är nästan alltid en serie man ser i ordning.
  const parts = useMemo(() => {
    const list = collection?.parts ?? [];
    return [...list].sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''));
  }, [collection?.parts]);

  // Sett/osett härleds ur biblioteket — bara efter mount (Firestore/localStorage
  // finns inte på server; matchar resten av sidans mounted-mönster).
  const seenIds = useMemo(() => {
    // `mounted` alone is NOT enough: it flips on the first effect, long before the
    // Firestore watchlist snapshot lands. In that window getItem returns null for
    // every already-tracked film, so "osedda" would include films the user has
    // marked 'sedd' — and the bulk add hard-writes status: 'vill_se' over them,
    // up to ADD_UNSEEN_CAP at a time. Wait for the snapshot before judging.
    if (!mounted || watchlistLoading) return new Set<number>();
    const s = new Set<number>();
    for (const p of parts) {
      if (getItem('movie', p.id)?.status === 'sedd') s.add(p.id);
    }
    return s;
  }, [mounted, watchlistLoading, parts, getItem]);

  const unseen = useMemo(
    () => (mounted && !watchlistLoading ? parts.filter(p => !seenIds.has(p.id)) : []),
    [mounted, watchlistLoading, parts, seenIds],
  );
  // Osedda som inte ens ligger i biblioteket — kandidater för "lägg till alla".
  // Gate på getItem (inte bara status): en film som redan ligger som vill_se/
  // avbruten ska inte röras (addItem är en set-doc och skulle nollställa addedAt).
  const unseenNotInLibrary = useMemo(
    () => (mounted ? unseen.filter(p => !getItem('movie', p.id)) : []),
    [mounted, unseen, getItem],
  );

  // BIN-135: osedda att hämta providers för — capat. Lat: bara när expanderat.
  const toFetch = useMemo(() => unseen.slice(0, STREAM_CAP), [unseen]);
  const streamingQueries = useQueries({
    queries: toFetch.map(p => ({
      queryKey: ['movie-lite', p.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getMovieLite(p.id, { signal }),
      enabled: mounted && showStreaming,
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });
  const streamingLoading = showStreaming && streamingQueries.some(q => q.isLoading);
  const streamingFilms = streamingQueries
    .map((q, i) => ({ tmdbId: toFetch[i]?.id ?? 0, providerIds: seFlatrateProviderIds(q.data) }))
    .filter((_, i) => !!streamingQueries[i].data);
  const myProviderIds = mounted ? (user?.myProviders ?? []) : [];
  const streamSummary = summarizeCollectionStreaming(streamingFilms, myProviderIds);

  // En enstaka film är ingen "samling" värd en sektion.
  if (!collection || parts.length < 2) return null;

  const seenCount = seenIds.size;

  async function addAllUnseen() {
    if (adding || unseenNotInLibrary.length === 0) return;
    setAdding(true);
    try {
      // BIN-159: bunden write-fan-out. Samlingar är normalt <30 filmer, men
      // cappa ändå så en patologiskt stor samling inte avfyrar hundratals
      // sekventiella Firestore-skrivningar.
      for (const p of unseenNotInLibrary.slice(0, ADD_UNSEEN_CAP)) {
        await addItem(buildWatchlistAddPayload({
          tmdbId: p.id,
          mediaType: 'movie',
          status: 'vill_se',
          title: preferOriginalTitle(p.title, p.original_title) || p.title || '',
          posterPath: p.poster_path,
          releaseYear: p.release_date ? parseInt(p.release_date.slice(0, 4), 10) || null : null,
          genreIds: p.genre_ids ?? [],
          // New add; the collection list carries no provider data. Explicit [] —
          // see OnboardingFlow for why a new doc must not omit the arrays.
          providers: [],
        }));
      }
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="detail-section" style={{ borderTop: '1px solid var(--rule)', paddingTop: 28 }}>
      <div className="head">
        <div>
          <h2>{collection.name}</h2>
          {/* Gated on the snapshot too: pre-settle seenCount is 0 for everyone, so
              this would confidently tell a user who has seen the whole collection
              that they have seen none of it. */}
          {mounted && !watchlistLoading && (
            <div className="sub">
              {seenCount} av {parts.length} sedda
              {unseen.length > 0 && ` · ${unseen.length} kvar`}
            </div>
          )}
        </div>
        {mounted && unseenNotInLibrary.length > 0 && (
          <button
            onClick={addAllUnseen}
            disabled={adding}
            className="btn btn-ghost btn-sm inline-flex items-center gap-1"
          >
            <Plus size={12} />
            Lägg alla osedda i vill se
          </button>
        )}
      </div>

      {mounted && unseen.length > 0 && (
        <div style={{ marginTop: 2, marginBottom: 14 }}>
          <button
            onClick={() => setShowStreaming(s => !s)}
            className="btn btn-ghost btn-sm inline-flex items-center gap-1"
            aria-expanded={showStreaming}
          >
            Var streamar de osedda? {showStreaming ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showStreaming && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-2)' }}>
              {streamingLoading ? (
                <span className="text-ink-3">Hämtar tillgänglighet…</span>
              ) : streamSummary.considered === 0 ? (
                <span className="text-ink-3">Ingen abonnemangstillgänglighet hittad i Sverige.</span>
              ) : (
                <span>
                  {streamingSummaryText(streamSummary)}
                  {unseen.length > STREAM_CAP && (
                    <span className="text-ink-3"> · visar {STREAM_CAP} av {unseen.length}</span>
                  )}
                </span>
              )}
              {/* TMDB-attribution krävs på varje yta som visar provider-data. */}
              {!streamingLoading && streamSummary.withAnyProvider > 0 && (
                <div style={{ marginTop: 6 }}><JustWatchCredit /></div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="similar-grid">
        {parts.map(part => (
          <SeenPosterCard
            key={part.id}
            href={`/movie/${part.id}/`}
            title={preferOriginalTitle(part.title, part.original_title) || part.title || ''}
            year={part.release_date ? part.release_date.slice(0, 4) : ''}
            posterPath={part.poster_path}
            seen={mounted && seenIds.has(part.id)}
            isCurrent={part.id === currentMovieId}
          />
        ))}
      </div>
    </section>
  );
}
