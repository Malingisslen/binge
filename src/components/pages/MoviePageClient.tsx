'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Film } from 'lucide-react';
import { useMovie } from '@/hooks/useTMDB';
import { usePageMeta } from '@/hooks/usePageMeta';
import { JsonLd, movieSchema, breadcrumbSchema } from '@/components/title/JsonLd';
import { posterUrl, profileUrl, logoUrl } from '@/lib/tmdb/client';
import StatusButton from '@/components/title/StatusButton';
import NotInterestedButton from '@/components/title/NotInterestedButton';
import AddToListButton from '@/components/title/AddToListButton';
import AddToGroupButton from '@/components/title/AddToGroupButton';
import RatingStars from '@/components/title/RatingStars';
import ProviderTag from '@/components/title/ProviderTag';
import NotesBlock from '@/components/title/NotesBlock';
import RecCard from '@/components/recommendations/RecCard';
import ReviewList from '@/components/title/ReviewList';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { canonicalProviderId } from '@/lib/tmdb/providers';
import { toneForGenreIds } from '@/lib/duotone';
import ClientOnly from '@/components/utils/ClientOnly';
import type { TMDBMovie } from '@/types';

// Direction H movie-detail page. Same duotone/raw boundary as TV detail:
//   - Hero poster → duotone (identification)
//   - Trailer + cast portraits → raw (preview)
//   - Recommendations at bottom → duotone (back to navigation)

export default function MoviePageClient({ id, initialData }: { id: string; initialData?: TMDBMovie }) {
  const movieId = parseInt(id, 10);
  const { data: movie, isLoading } = useMovie(movieId, initialData);
  const { getItem, updateRating, updateNotes } = useWatchlist();
  useAuth();
  const [showRentBuy, setShowRentBuy] = useState(false);
  // mounted-flag förhindrar hydration mismatch: SSR/initial-render visar inget
  // watchlist-state (eftersom Firebase/localStorage inte finns på server), och
  // efter mount byter den till riktiga värdet. Det matchar också SEO-intentet:
  // Googlebot ska inte se "i biblioteket"-chip eller stjärnbetyg i HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mappedRecs = useMemo(
    () => (movie?.recommendations?.results?.slice(0, 8) ?? []).map(r => ({ ...r, media_type: 'movie' as const })),
    [movie?.recommendations]
  );

  const displayTitle = movie ? preferOriginalTitle(movie.title, movie.original_title) : '';
  const releaseYear = movie?.release_date ? movie.release_date.slice(0, 4) : '';
  usePageMeta({
    title: displayTitle
      ? `${displayTitle}${releaseYear ? ` (${releaseYear})` : ''} — var streamar jag?`
      : 'Film',
    description: movie
      ? `${displayTitle}${releaseYear ? ` (${releaseYear})` : ''}. ${movie.overview?.slice(0, 180) ?? 'Se var filmen finns att streama i Sverige.'}`
      : undefined,
    ogImage: movie?.poster_path ? posterUrl(movie.poster_path, 'w500') ?? undefined : undefined,
  });

  if (isLoading) return <div className="text-sm text-ink-3 py-4">Laddar...</div>;
  if (!movie) return <div className="text-sm text-ink-3 py-4">Filmen hittades inte.</div>;

  const watchlistItem = mounted ? getItem(movie.id) : undefined;
  const poster = posterUrl(movie.poster_path, 'w500');
  const tone = toneForGenreIds(movie.genres.map(g => g.id));
  const providers = movie['watch/providers']?.results?.SE;
  const flatrate = providers?.flatrate ?? [];
  const free = providers?.free ?? [];
  const ads = providers?.ads ?? [];
  const subscription = [...flatrate, ...free, ...ads];
  const rent = providers?.rent ?? [];
  const buy = providers?.buy ?? [];
  const hasRentBuy = rent.length > 0 || buy.length > 0;
  const year = movie.release_date?.substring(0, 4) ?? '—';
  const genres = movie.genres.map(g => g.name).join(', ');
  const cast = movie.credits?.cast?.slice(0, 10) ?? [];
  const directors = movie.credits?.crew?.filter(c => c.job === 'Director') ?? [];
  const writers = movie.credits?.crew?.filter(c => c.job === 'Screenplay' || c.job === 'Writer') ?? [];
  const trailer = movie.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer')
    ?? movie.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Teaser');

  return (
    <>
      {/* Schema.org structured data — rich snippets + knowledge panel i Google */}
      <JsonLd data={movieSchema(movie)} />
      <JsonLd data={breadcrumbSchema([
        { name: 'Binge.nu', url: 'https://binge.nu/' },
        { name: 'Filmer', url: 'https://binge.nu/films/' },
        { name: displayTitle, url: `https://binge.nu/movie/${movie.id}/` },
      ])} />

      <div className="crumb">Bibliotek · filmer · {displayTitle}</div>

      <div className="detail-hero">
        <div className="poster-wrap">
          <div className={`poster duo-${tone}`}>
            {poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt={displayTitle} loading="eager" decoding="async" width={342} height={513} />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'oklch(0.85 0.02 80)',
              }}>
                <Film size={48} />
              </div>
            )}
          </div>
        </div>

        <div className="meta-col">
          <div className="chips-line">
            {watchlistItem && (
              <span className="chip acc">
                <span className="dot" />i biblioteket
              </span>
            )}
            <span className="kind">
              FILM · {year} · {movie.runtime} min
            </span>
            {genres && <span className="kind">{genres}</span>}
          </div>
          <h1>{displayTitle}</h1>
          {(directors.length > 0 || writers.length > 0) && (
            <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)', letterSpacing: 0.04 }}>
              {directors.length > 0 && (
                <>
                  regi:{' '}
                  {directors.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && ', '}
                      <Link href={`/person/${d.id}/`} style={{ color: 'var(--ink-2)', textDecoration: 'none', borderBottom: '1px solid var(--rule)' }}>
                        {d.name}
                      </Link>
                    </span>
                  ))}
                </>
              )}
              {directors.length > 0 && writers.length > 0 && '  ·  '}
              {writers.length > 0 && (
                <>
                  manus:{' '}
                  {writers.map((w, i) => (
                    <span key={w.id}>
                      {i > 0 && ', '}
                      <Link href={`/person/${w.id}/`} style={{ color: 'var(--ink-2)', textDecoration: 'none', borderBottom: '1px solid var(--rule)' }}>
                        {w.name}
                      </Link>
                    </span>
                  ))}
                </>
              )}
            </div>
          )}
          {movie.overview && <p className="syn">{movie.overview}</p>}
          <div className="stats">
            <span><span className="k">år</span><strong>{year}</strong></span>
            {movie.runtime ? (
              <span><span className="k">längd</span><strong>{movie.runtime} min</strong></span>
            ) : null}
            <span><span className="k">tmdb</span><strong>{movie.vote_average.toFixed(1)} / 10</strong></span>
            {movie.imdb_id && (
              <span>
                <span className="k">imdb</span>
                <a href={`https://www.imdb.com/title/${movie.imdb_id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px solid var(--rule)' }}>
                  öppna →
                </a>
              </span>
            )}
          </div>

          <ClientOnly>
            <div className="actions-row">
              <StatusButton
                tmdbId={movie.id}
                mediaType="movie"
                title={displayTitle}
                posterPath={movie.poster_path}
                releaseYear={parseInt(year, 10) || null}
                providers={Array.from(new Set([...subscription, ...rent, ...buy].map(p => canonicalProviderId(p.provider_id))))}
                genreIds={movie.genres.map(g => g.id)}
              />
              <div>
                {watchlistItem && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: 0.12, textTransform: 'uppercase', marginBottom: 3 }}>
                    Ditt betyg
                  </div>
                )}
                <RatingStars
                  rating={watchlistItem?.rating ?? null}
                  onChange={r => watchlistItem && updateRating(movie.id, r)}
                  readonly={!watchlistItem}
                  size="lg"
                />
              </div>
              <AddToListButton tmdbId={movie.id} mediaType="movie" title={displayTitle} posterPath={movie.poster_path} />
              <AddToGroupButton
                tmdbId={movie.id}
                mediaType="movie"
                title={displayTitle}
                posterPath={movie.poster_path}
                releaseYear={movie.release_date ? parseInt(movie.release_date.substring(0, 4), 10) : null}
              />
              <NotInterestedButton tmdbId={movie.id} mediaType="movie" title={displayTitle} />
            </div>
          </ClientOnly>

          {subscription.length > 0 && (
            <div className="providers-row">
              <span className="lab">finns på</span>
              {subscription.map(p => {
                const logo = logoUrl(p.logo_path);
                return logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p.provider_id} src={logo} alt={p.provider_name} title={p.provider_name} style={{ width: 28, height: 28, borderRadius: 3, border: '1px solid var(--rule)' }} loading="lazy" decoding="async" width={28} height={28} />
                ) : (
                  <ProviderTag key={p.provider_id} provider={p} size="md" />
                );
              })}
              {hasRentBuy && (
                <button
                  onClick={() => setShowRentBuy(!showRentBuy)}
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 4 }}
                >
                  Hyr & köp {showRentBuy ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
            </div>
          )}

          {showRentBuy && hasRentBuy && (
            <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>
              {rent.length > 0 && (
                <div>
                  <span style={{ letterSpacing: 0.12, textTransform: 'uppercase', marginRight: 6 }}>Hyr:</span>
                  {rent.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" />)}
                </div>
              )}
              {buy.length > 0 && (
                <div>
                  <span style={{ letterSpacing: 0.12, textTransform: 'uppercase', marginRight: 6 }}>Köp:</span>
                  {buy.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" />)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Trailer — raw 16:9 (preview surface) */}
      {trailer && (
        <section className="detail-section">
          <div className="head">
            <h2>Trailer</h2>
            <span className="meta">YouTube · {trailer.type}</span>
          </div>
          <div className="raw ratio-16-9" style={{ maxWidth: 720 }}>
            <iframe
              src={`https://www.youtube.com/embed/${trailer.key}`}
              title={trailer.name}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ width: '100%', height: '100%', border: 0 }}
            />
          </div>
        </section>
      )}

      {/* Cast — raw 1:1 circular portraits (preview surface) */}
      {cast.length > 0 && (
        <section className="detail-section">
          <div className="head">
            <h2>Skådespelare</h2>
            <span className="meta">huvudroller · {cast.length} av {movie.credits?.cast?.length ?? cast.length}</span>
          </div>
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 4 }}>
            {cast.map(person => (
              <Link
                key={person.id}
                href={`/person/${person.id}/`}
                style={{ flexShrink: 0, width: 92, textDecoration: 'none', color: 'inherit', textAlign: 'center' }}
              >
                <div className="raw ratio-1-1" style={{ width: 72, height: 72, margin: '0 auto 8px', borderRadius: 999 }}>
                  {profileUrl(person.profile_path) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profileUrl(person.profile_path)!}
                      alt={person.name}
                      loading="lazy"
                      decoding="async"
                      width={72}
                      height={72}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'oklch(0.85 0.02 80)',
                      color: 'var(--ink-3)',
                      fontWeight: 600, fontSize: 14,
                    }}>
                      {person.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.25 }}>{person.name}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.2 }}>
                  {person.character}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Notes + Reviews — auth-beroende, klient-only för att inte skapa
          hydration mismatch och inte exponeras för Googlebot (PII-risk) */}
      <ClientOnly>
        {watchlistItem && (
          <section className="detail-section">
            <div className="head">
              <h2>Din anteckning</h2>
            </div>
            <NotesBlock notes={watchlistItem.notes} onChange={notes => updateNotes(movie.id, notes)} />
          </section>
        )}
        <section className="detail-section">
          <ReviewList tmdbId={movie.id} mediaType="movie" title={displayTitle} posterPath={movie.poster_path} />
        </section>
      </ClientOnly>

      {/* Similar films — back to duotone (navigation surface) */}
      {mappedRecs.length > 0 && (
        <section className="detail-section" style={{ borderTop: '1px solid var(--rule)', paddingTop: 28 }}>
          <div className="head">
            <div>
              <h2>Liknande filmer</h2>
              <div className="sub">{genres}</div>
            </div>
            <span className="meta">{mappedRecs.length} förslag</span>
          </div>
          <div className="similar-grid">
            {mappedRecs.slice(0, 5).map(rec => (
              <RecCard key={`${rec.media_type}-${rec.id}`} item={rec} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
