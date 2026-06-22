'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Plus } from 'lucide-react';
import { useCollection } from '@/hooks/useTMDB';
import { useWatchlist } from '@/hooks/useWatchlist';
import { posterUrl } from '@/lib/tmdb/client';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';

/**
 * BIN-94 — franchise/collection completion tracking.
 *
 * När en film hör till en TMDB-samling (belongs_to_collection) listar vi hela
 * samlingen med varje films sett/osett-läge (korsrefererat mot biblioteket) och
 * en "lägg till alla osedda i vill se"-genväg. En query per samling (useCollection),
 * ingen fan-out.
 *
 * Avsiktligt utelämnat i v1: per-film "var streamar den"-sammanfattning. Det
 * kräver ett providers-anrop per osedd film (fan-out) → egen kostnadsbudget,
 * filad som uppföljning på BIN-94.
 */
export default function CollectionSection({
  collectionId,
  currentMovieId,
}: {
  collectionId: number;
  currentMovieId: number;
}) {
  const { data: collection } = useCollection(collectionId);
  const { getItem, addItem } = useWatchlist();
  const [mounted, setMounted] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => setMounted(true), []);

  // Sortera kronologiskt — samlingar är nästan alltid en serie man ser i ordning.
  const parts = useMemo(() => {
    const list = collection?.parts ?? [];
    return [...list].sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''));
  }, [collection?.parts]);

  // Sett/osett härleds ur biblioteket — bara efter mount (Firestore/localStorage
  // finns inte på server; matchar resten av sidans mounted-mönster).
  const seenIds = useMemo(() => {
    if (!mounted) return new Set<number>();
    const s = new Set<number>();
    for (const p of parts) {
      if (getItem(p.id)?.status === 'sedd') s.add(p.id);
    }
    return s;
  }, [mounted, parts, getItem]);

  const unseen = useMemo(
    () => (mounted ? parts.filter(p => !seenIds.has(p.id)) : []),
    [mounted, parts, seenIds],
  );
  // Osedda som inte ens ligger i biblioteket — kandidater för "lägg till alla".
  // Gate på getItem (inte bara status): en film som redan ligger som vill_se/
  // avbruten ska inte röras (addItem är en set-doc och skulle nollställa addedAt).
  const unseenNotInLibrary = useMemo(
    () => (mounted ? unseen.filter(p => !getItem(p.id)) : []),
    [mounted, unseen, getItem],
  );

  // En enstaka film är ingen "samling" värd en sektion.
  if (!collection || parts.length < 2) return null;

  const seenCount = seenIds.size;

  async function addAllUnseen() {
    if (adding || unseenNotInLibrary.length === 0) return;
    setAdding(true);
    try {
      for (const p of unseenNotInLibrary) {
        await addItem({
          tmdbId: p.id,
          mediaType: 'movie',
          status: 'vill_se',
          title: preferOriginalTitle(p.title, p.original_title) || p.title || '',
          posterPath: p.poster_path,
          releaseYear: p.release_date ? parseInt(p.release_date.slice(0, 4), 10) || null : null,
          rating: null,
          notes: null,
          totalSeasons: null,
          lastWatchedSeason: null,
          lastWatchedEpisode: null,
          providers: [],
          genreIds: p.genre_ids ?? [],
          tmdbStatus: null,
        });
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
          {mounted && (
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

      <div className="similar-grid">
        {parts.map(part => {
          const title = preferOriginalTitle(part.title, part.original_title) || part.title || '';
          const year = part.release_date ? part.release_date.slice(0, 4) : '';
          const poster = posterUrl(part.poster_path, 'w342');
          const isSeen = seenIds.has(part.id);
          const isCurrent = part.id === currentMovieId;
          return (
            <Link
              key={part.id}
              href={`/movie/${part.id}/`}
              style={{ textDecoration: 'none', color: 'inherit', position: 'relative', display: 'block' }}
              aria-current={isCurrent ? 'page' : undefined}
            >
              <div className="poster" style={{ opacity: mounted && isSeen ? 0.55 : 1 }}>
                {poster && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={poster} alt={title} loading="lazy" decoding="async" width={342} height={513} />
                )}
                {mounted && isSeen && (
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
              <div style={{ fontSize: 12.5, fontWeight: isCurrent ? 600 : 500, marginTop: 6, lineHeight: 1.25 }}>
                {title}
              </div>
              {year && <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1 }}>{year}</div>}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
