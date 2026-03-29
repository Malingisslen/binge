'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useMovie } from '@/hooks/useTMDB';
import { posterUrl, profileUrl } from '@/lib/tmdb/client';
import StatusButton from '@/components/title/StatusButton';
import RatingStars from '@/components/title/RatingStars';
import ProviderTag from '@/components/title/ProviderTag';
import NotesTextarea from '@/components/title/NotesTextarea';
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

  const mappedRecs = useMemo(
    () => (movie?.recommendations?.results?.slice(0, 8) ?? []).map(r => ({ ...r, media_type: 'movie' as const })),
    [movie?.recommendations]
  );

  if (isLoading) return <div className="text-sm text-text-muted py-4">Laddar...</div>;
  if (!movie) return <div className="text-sm text-text-muted py-4">Filmen hittades inte.</div>;

  const watchlistItem = getItem(movie.id);
  const poster = posterUrl(movie.poster_path, 'w500');
  const providers = movie['watch/providers']?.results?.SE;
  const flatrate = providers?.flatrate ?? [];
  const rent = providers?.rent ?? [];
  const buy = providers?.buy ?? [];
  const year = movie.release_date?.substring(0, 4) ?? '—';
  const genres = movie.genres.map(g => g.name).join(', ');
  const cast = movie.credits?.cast?.slice(0, 10) ?? [];
  const directors = movie.credits?.crew?.filter(c => c.job === 'Director') ?? [];
  const writers = movie.credits?.crew?.filter(c => c.job === 'Screenplay' || c.job === 'Writer') ?? [];
  const trailer = movie.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer')
    ?? movie.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Teaser');

  return (
    <div>
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <div className="shrink-0">
          {poster ? (
            <img src={poster} alt={movie.title} className="w-[120px] md:w-[180px] rounded-sm" />
          ) : (
            <div className="w-[180px] aspect-[2/3] bg-[#ddd8d0] rounded-sm" />
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-[18px] font-bold text-text-primary mb-1">{movie.title}</h1>
          <div className="text-sm text-text-muted mb-1">
            {year} · {movie.runtime} min · {genres}
          </div>
          {(directors.length > 0 || writers.length > 0) && (
            <div className="text-xs text-text-muted mb-2">
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
          <div className="text-sm text-text-secondary mb-1">
            TMDB: {movie.vote_average.toFixed(1)}/10
            {movie.imdb_id && (
              <a href={`https://www.imdb.com/title/${movie.imdb_id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-text-muted ml-2 no-underline hover:text-accent">IMDb</a>
            )}
          </div>

          <div className="flex items-center gap-2 mb-3">
            <StatusButton
              tmdbId={movie.id}
              mediaType="movie"
              title={movie.title}
              posterPath={movie.poster_path}
              releaseYear={parseInt(year, 10) || null}
              providers={[...flatrate, ...rent, ...buy].map(p => p.provider_id)}
            />
            <RatingStars
              rating={watchlistItem?.rating ?? null}
              onChange={r => watchlistItem && updateRating(movie.id, r)}
              readonly={!watchlistItem}
              size="md"
            />
          </div>

          {(flatrate.length > 0 || rent.length > 0 || buy.length > 0) && (
            <div className="mb-3">
              {flatrate.length > 0 && (
                <div className="mb-1">
                  <span className="text-xxs text-text-muted uppercase tracking-[0.5px] mr-1">Streama:</span>
                  {flatrate.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" />)}
                </div>
              )}
              {rent.length > 0 && (
                <div className="mb-1">
                  <span className="text-xxs text-text-muted uppercase tracking-[0.5px] mr-1">Hyr:</span>
                  {rent.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" />)}
                </div>
              )}
              {buy.length > 0 && (
                <div className="mb-1">
                  <span className="text-xxs text-text-muted uppercase tracking-[0.5px] mr-1">Köp:</span>
                  {buy.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" />)}
                </div>
              )}
            </div>
          )}

          {movie.overview && (
            <p className="text-base text-text-secondary leading-relaxed mb-3">{movie.overview}</p>
          )}

          {watchlistItem && (
            <div className="mb-3">
              <NotesTextarea
                value={watchlistItem.notes}
                onChange={notes => updateNotes(movie.id, notes)}
              />
            </div>
          )}
        </div>
      </div>

      {trailer && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-text-secondary mb-2">Trailer</h2>
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

      {cast.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-text-secondary mb-2">Skådespelare</h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {cast.map(person => (
              <Link key={person.id} href={`/person/${person.id}/`} className="shrink-0 w-[70px] no-underline text-text-primary">
                {profileUrl(person.profile_path) ? (
                  <img
                    src={profileUrl(person.profile_path)!}
                    alt={person.name}
                    className="w-[70px] h-[90px] object-cover rounded-sm mb-[2px]"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-[70px] h-[90px] bg-[#ddd8d0] rounded-sm mb-[2px]" />
                )}
                <div className="text-xs font-semibold truncate">{person.name}</div>
                <div className="text-xxs text-text-muted truncate">{person.character}</div>
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
  );
}
