'use client';

import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Film } from 'lucide-react';
import { useMovie } from '@/hooks/useTMDB';
import { posterUrl, profileUrl, backdropUrl, logoUrl } from '@/lib/tmdb/client';
import StatusButton from '@/components/title/StatusButton';
import AddToListButton from '@/components/title/AddToListButton';
import RatingStars from '@/components/title/RatingStars';
import ProviderTag from '@/components/title/ProviderTag';
import NotesBlock from '@/components/title/NotesBlock';
import RecommendationsSection from '@/components/title/RecommendationsSection';
import ReviewList from '@/components/title/ReviewList';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';

export default function MoviePageClient({ id }: { id: string }) {
  const movieId = parseInt(id, 10);
  const { data: movie, isLoading } = useMovie(movieId);
  const { getItem, updateRating, updateNotes } = useWatchlist();
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];
  const [showRentBuy, setShowRentBuy] = useState(false);

  const mappedRecs = useMemo(
    () => (movie?.recommendations?.results?.slice(0, 8) ?? []).map(r => ({ ...r, media_type: 'movie' as const })),
    [movie?.recommendations]
  );

  useEffect(() => {
    if (movie) document.title = `${movie.title} — Binge.nu`;
    return () => { document.title = 'Binge.nu — Håll koll på vad du tittar på'; };
  }, [movie]);

  if (isLoading) return <div className="text-sm text-text-muted py-4">Laddar...</div>;
  if (!movie) return <div className="text-sm text-text-muted py-4">Filmen hittades inte.</div>;

  const watchlistItem = getItem(movie.id);
  const poster = posterUrl(movie.poster_path, 'w500');
  const backdrop = backdropUrl(movie.backdrop_path);
  const providers = movie['watch/providers']?.results?.SE;
  const flatrate = providers?.flatrate ?? [];
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
    <div className="-m-[14px_-18px] md:-m-[14px_-18px]">
      {/* Hero backdrop */}
      <div className="relative w-full h-[180px] md:h-[280px] bg-[#2a2a2a] overflow-hidden">
        {backdrop && (
          <img
            src={backdrop}
            alt=""
            className="w-full h-full object-cover object-[center_20%] opacity-60"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-page via-page/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 px-[18px] pb-4 flex gap-4 items-end">
          {poster ? (
            <img src={poster} alt={movie.title} className="w-[100px] md:w-[140px] rounded-sm shadow-lg shrink-0 relative z-10" />
          ) : (
            <div className="w-[100px] md:w-[140px] aspect-[2/3] bg-[#ddd8d0] rounded-sm shrink-0 flex items-center justify-center">
              <Film size={32} className="text-text-muted" />
            </div>
          )}
          <div className="relative z-10 pb-1">
            <h1 className="text-[22px] md:text-[28px] font-bold text-text-primary leading-tight mb-1">{movie.title}</h1>
            <div className="text-sm text-text-secondary">
              {year} · {movie.runtime} min · {genres}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-[18px] pt-4">
        {/* Credits */}
        {(directors.length > 0 || writers.length > 0) && (
          <div className="text-xs text-text-muted mb-3">
            {directors.length > 0 && (
              <>Regi: {directors.map((d, i) => (
                <span key={d.id}>{i > 0 && ', '}<Link href={`/person/${d.id}/`} className="text-text-secondary no-underline hover:text-accent">{d.name}</Link></span>
              ))}</>
            )}
            {directors.length > 0 && writers.length > 0 && ' · '}
            {writers.length > 0 && (
              <>Manus: {writers.map((w, i) => (
                <span key={w.id}>{i > 0 && ', '}<Link href={`/person/${w.id}/`} className="text-text-secondary no-underline hover:text-accent">{w.name}</Link></span>
              ))}</>
            )}
          </div>
        )}

        {/* TMDB rating + IMDb link */}
        <div className="text-xs text-text-muted mb-3">
          TMDB: {movie.vote_average.toFixed(1)}/10
          {movie.imdb_id && (
            <a href={`https://www.imdb.com/title/${movie.imdb_id}`} target="_blank" rel="noopener noreferrer" className="text-text-muted ml-2 no-underline hover:text-accent">IMDb</a>
          )}
        </div>

        {/* CTA actions — prominent */}
        <div className="flex items-center gap-3 mb-4">
          <StatusButton
            tmdbId={movie.id}
            mediaType="movie"
            title={movie.title}
            posterPath={movie.poster_path}
            releaseYear={parseInt(year, 10) || null}
            providers={[...flatrate, ...rent, ...buy].map(p => p.provider_id)}
          />
          <div>
            {watchlistItem && (
              <div className="text-xxs text-text-muted mb-[2px]">Ditt betyg</div>
            )}
            <RatingStars
              rating={watchlistItem?.rating ?? null}
              onChange={r => watchlistItem && updateRating(movie.id, r)}
              readonly={!watchlistItem}
              size="lg"
            />
          </div>
          <AddToListButton tmdbId={movie.id} mediaType="movie" title={movie.title} posterPath={movie.poster_path} />
        </div>

        {/* Providers — streaming prominent, rent/buy collapsed */}
        {(flatrate.length > 0 || hasRentBuy) && (
          <div className="mb-4 bg-surface border border-border-main rounded-sm p-3">
            {flatrate.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xxs text-text-muted uppercase tracking-[0.5px] font-semibold">Streama:</span>
                {flatrate.map(p => {
                  const logo = logoUrl(p.logo_path);
                  return logo ? (
                    <img key={p.provider_id} src={logo} alt={p.provider_name} title={p.provider_name} className="w-[28px] h-[28px] rounded-sm" />
                  ) : (
                    <ProviderTag key={p.provider_id} provider={p} size="md" />
                  );
                })}
              </div>
            )}
            {hasRentBuy && (
              <>
                {flatrate.length > 0 && <div className="border-t border-border-light my-2" />}
                <button
                  onClick={() => setShowRentBuy(!showRentBuy)}
                  className="flex items-center gap-1 text-xs text-text-muted bg-transparent border-none cursor-pointer p-0 font-[inherit] hover:text-text-secondary"
                >
                  Hyr & köp
                  {showRentBuy ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {showRentBuy && (
                  <div className="mt-2 space-y-1">
                    {rent.length > 0 && (
                      <div>
                        <span className="text-xxs text-text-muted uppercase tracking-[0.5px] mr-1">Hyr:</span>
                        {rent.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" />)}
                      </div>
                    )}
                    {buy.length > 0 && (
                      <div>
                        <span className="text-xxs text-text-muted uppercase tracking-[0.5px] mr-1">Köp:</span>
                        {buy.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" />)}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Synopsis */}
        {movie.overview && (
          <div className="mb-4">
            <h2 className="text-sm font-bold text-text-secondary pb-1 border-b border-border-light mb-2">Handling</h2>
            <p className="text-sm text-text-secondary leading-relaxed">{movie.overview}</p>
          </div>
        )}

        {watchlistItem && <NotesBlock notes={watchlistItem.notes} onChange={notes => updateNotes(movie.id, notes)} />}

        {/* Trailer */}
        {trailer && (
          <div className="mb-4">
            <h2 className="text-sm font-bold text-text-secondary pb-1 border-b border-border-light mb-2">Trailer</h2>
            <div className="aspect-video max-w-[560px] bg-black rounded-sm overflow-hidden">
              <iframe
                src={`https://www.youtube.com/embed/${trailer.key}`}
                title={trailer.name}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-none"
              />
            </div>
          </div>
        )}

        {/* Cast with images */}
        {cast.length > 0 && (
          <div className="mb-4">
            <h2 className="text-sm font-bold text-text-secondary pb-1 border-b border-border-light mb-2">Skådespelare</h2>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {cast.map(person => (
                <Link key={person.id} href={`/person/${person.id}/`} className="shrink-0 w-[70px] no-underline text-text-primary">
                  {profileUrl(person.profile_path) ? (
                    <img
                      src={profileUrl(person.profile_path)!}
                      alt={person.name}
                      className="w-[50px] h-[50px] object-cover rounded-full mb-[4px] mx-auto"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-[50px] h-[50px] rounded-full bg-[#ddd8d0] mb-[4px] mx-auto flex items-center justify-center text-xs text-text-muted font-semibold">
                      {person.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                  )}
                  <div className="text-xs font-semibold truncate text-center">{person.name}</div>
                  <div className="text-xxs text-text-muted truncate text-center">{person.character}</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <ReviewList tmdbId={movie.id} mediaType="movie" />

        <RecommendationsSection
          recommendations={mappedRecs}
          myProviders={myProviders}
          label="Rekommendationer"
        />
      </div>
    </div>
  );
}
