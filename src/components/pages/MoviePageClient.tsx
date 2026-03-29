'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useMovie } from '@/hooks/useTMDB';
import { posterUrl } from '@/lib/tmdb/client';
import StatusButton from '@/components/title/StatusButton';
import RatingStars from '@/components/title/RatingStars';
import ProviderTag from '@/components/title/ProviderTag';
import TitleGrid from '@/components/title/TitleGrid';
import NotesTextarea from '@/components/title/NotesTextarea';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import type { TMDBProvider } from '@/types';

export default function MoviePageClient({ id }: { id: string }) {
  const movieId = parseInt(id, 10);
  const { data: movie, isLoading } = useMovie(movieId);
  const { getItem, updateRating, updateNotes } = useWatchlist();
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];
  const [onlyMyServices, setOnlyMyServices] = useState(false);

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
              </Link>
            ))}
          </div>
        </div>
      )}

      <RecommendationsSection
        recommendations={recommendations.map(r => ({ ...r, media_type: 'movie' as const }))}
        myProviders={myProviders}
        onlyMyServices={onlyMyServices}
        setOnlyMyServices={setOnlyMyServices}
        label="Rekommendationer"
      />
    </div>
  );
}

function RecommendationsSection({ recommendations, myProviders, onlyMyServices, setOnlyMyServices, label }: {
  recommendations: (import('@/types').TMDBSearchResult & { media_type: 'movie' | 'tv' })[];
  myProviders: number[];
  onlyMyServices: boolean;
  setOnlyMyServices: (v: boolean) => void;
  label: string;
}) {
  const rawProviderMap = useSearchProviders(recommendations);

  const filtered = useMemo(() => {
    if (!onlyMyServices || myProviders.length === 0) return recommendations;
    return recommendations.filter(r => {
      const p = rawProviderMap[`${r.media_type}-${r.id}`];
      return p?.flatrate?.some(f => myProviders.includes(f.provider_id));
    });
  }, [recommendations, onlyMyServices, myProviders, rawProviderMap]);

  const providerMap = useMemo(() => {
    const map: Record<string, TMDBProvider[]> = {};
    for (const [key, data] of Object.entries(rawProviderMap)) {
      if (data.flatrate) map[key] = data.flatrate;
    }
    return map;
  }, [rawProviderMap]);

  if (recommendations.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-bold text-text-secondary">{label}</h2>
        {myProviders.length > 0 && (
          <span
            onClick={() => setOnlyMyServices(!onlyMyServices)}
            className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
              onlyMyServices ? 'bg-accent text-white' : 'text-text-muted'
            }`}
          >
            Mina tjänster
          </span>
        )}
      </div>
      <div className="bg-surface border border-border-main rounded-sm">
        <TitleGrid items={filtered} providerMap={providerMap} />
      </div>
    </div>
  );
}
