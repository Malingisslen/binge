'use client';

import { useMovie } from '@/hooks/useTMDB';
import { posterUrl } from '@/lib/tmdb/client';
import StatusButton from '@/components/title/StatusButton';
import RatingStars from '@/components/title/RatingStars';
import ProviderTag from '@/components/title/ProviderTag';
import TitleGrid from '@/components/title/TitleGrid';
import { useWatchlist } from '@/hooks/useWatchlist';

export default function MoviePageClient({ id }: { id: string }) {
  const movieId = parseInt(id, 10);
  const { data: movie, isLoading } = useMovie(movieId);
  const { getItem, updateRating, updateNotes } = useWatchlist();

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
  const recommendations = movie.recommendations?.results?.slice(0, 8) ?? [];

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
          <div className="text-sm text-text-muted mb-2">
            {year} · {movie.runtime} min · {genres}
          </div>
          <div className="text-sm text-text-secondary mb-1">
            TMDB: {movie.vote_average.toFixed(1)}/10
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
              <textarea
                placeholder="Anteckning..."
                value={watchlistItem.notes ?? ''}
                onChange={e => updateNotes(movie.id, e.target.value || null)}
                maxLength={500}
                className="w-full max-w-[400px] h-[60px] px-2 py-1 text-base border border-border-main rounded-sm bg-surface font-[inherit] resize-none outline-none focus:border-accent"
              />
            </div>
          )}
        </div>
      </div>

      {cast.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-text-secondary mb-2">Skådespelare</h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {cast.map(person => (
              <div key={person.id} className="shrink-0 w-[70px]">
                {person.profile_path ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w185${person.profile_path}`}
                    alt={person.name}
                    className="w-[70px] h-[90px] object-cover rounded-sm mb-[2px]"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-[70px] h-[90px] bg-[#ddd8d0] rounded-sm mb-[2px]" />
                )}
                <div className="text-xs font-semibold truncate">{person.name}</div>
                <div className="text-xxs text-text-muted truncate">{person.character}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-text-secondary mb-2">Rekommendationer</h2>
          <div className="bg-surface border border-border-main rounded-sm">
            <TitleGrid items={recommendations.map(r => ({ ...r, media_type: 'movie' as const }))} />
          </div>
        </div>
      )}
    </div>
  );
}
