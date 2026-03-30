'use client';

import { useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useTVShow } from '@/hooks/useTMDB';
import { posterUrl, profileUrl } from '@/lib/tmdb/client';
import StatusButton from '@/components/title/StatusButton';
import AddToListButton from '@/components/title/AddToListButton';
import RatingStars from '@/components/title/RatingStars';
import ProviderTag from '@/components/title/ProviderTag';
import SeasonList from '@/components/tv/SeasonList';
import NotesBlock from '@/components/title/NotesBlock';
import RecommendationsSection from '@/components/title/RecommendationsSection';
import ReviewList from '@/components/title/ReviewList';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';
import { tvShowStatusLabel } from '@/lib/watchStatus';

export default function TVShowPageClient({ id }: { id: string }) {
  const showId = parseInt(id, 10);
  const { data: show, isLoading } = useTVShow(showId);
  const { getItem, updateRating, updateNotes } = useWatchlist();
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];
  const { isWatched, markEpisodeWatched, markSeasonWatched, getSeasonProgress } = useEpisodeProgressWithSync(showId);

  const mappedRecs = useMemo(
    () => (show?.recommendations?.results?.slice(0, 8) ?? []).map(r => ({ ...r, media_type: 'tv' as const })),
    [show?.recommendations]
  );

  useEffect(() => {
    if (show) document.title = `${show.name} — Binge.nu`;
    return () => { document.title = 'Binge.nu — Håll koll på vad du tittar på'; };
  }, [show]);

  if (isLoading) return <div className="text-sm text-text-muted py-4">Laddar...</div>;
  if (!show) return <div className="text-sm text-text-muted py-4">Serien hittades inte.</div>;

  const watchlistItem = getItem(show.id);
  const poster = posterUrl(show.poster_path, 'w500');
  const providers = show['watch/providers']?.results?.SE;
  const flatrate = providers?.flatrate ?? [];
  const rent = providers?.rent ?? [];
  const buy = providers?.buy ?? [];
  const yearStart = show.first_air_date?.substring(0, 4) ?? '—';
  const yearEnd = show.status === 'Ended' ? show.last_air_date?.substring(0, 4) : '';
  const genres = show.genres.map(g => g.name).join(', ');
  const cast = show.credits?.cast?.slice(0, 10) ?? [];
  const nextEp = show.next_episode_to_air;
  const creators = show.credits?.crew?.filter(c => c.job === 'Creator' || c.department === 'Creator') ?? [];
  const trailer = show.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer')
    ?? show.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Teaser');
  const imdbId = show.external_ids?.imdb_id;

  return (
    <div>
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <div className="shrink-0">
          {poster ? (
            <img src={poster} alt={show.name} className="w-[120px] md:w-[180px] rounded-sm" />
          ) : (
            <div className="w-[180px] aspect-[2/3] bg-[#ddd8d0] rounded-sm" />
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-[18px] font-bold text-text-primary mb-1">{show.name}</h1>
          <div className="text-sm text-text-muted mb-1">
            {yearStart}{yearEnd ? `–${yearEnd}` : '-'} · {show.number_of_seasons} säsong{show.number_of_seasons !== 1 ? 'er' : ''} · {genres}
          </div>
          {creators.length > 0 && (
            <div className="text-xs text-text-muted mb-1">
              Skapare: {creators.map((c, i) => (
                <span key={c.id}>{i > 0 && ', '}<Link href={`/person/${c.id}/`} className="text-text-secondary no-underline hover:text-accent">{c.name}</Link></span>
              ))}
            </div>
          )}
          <div className="text-xs text-text-muted mb-2">
            Status: {tvShowStatusLabel(show.status)} · TMDB: {show.vote_average.toFixed(1)}/10
            {imdbId && (
              <a href={`https://www.imdb.com/title/${imdbId}`} target="_blank" rel="noopener noreferrer" className="text-text-muted ml-2 no-underline hover:text-accent">IMDb</a>
            )}
          </div>

          <div className="flex items-center gap-2 mb-3">
            <StatusButton
              tmdbId={show.id}
              mediaType="tv"
              title={show.name}
              posterPath={show.poster_path}
              releaseYear={parseInt(yearStart, 10) || null}
              totalSeasons={show.number_of_seasons}
              providers={[...flatrate, ...rent, ...buy].map(p => p.provider_id)}
            />
            <RatingStars
              rating={watchlistItem?.rating ?? null}
              onChange={r => watchlistItem && updateRating(show.id, r)}
              readonly={!watchlistItem}
              size="md"
            />
            <AddToListButton tmdbId={show.id} mediaType="tv" title={show.name} posterPath={show.poster_path} />
          </div>

          {nextEp && (
            <div className="text-sm text-text-secondary mb-2">
              Nästa avsnitt: S{nextEp.season_number}E{nextEp.episode_number} — {nextEp.name} ({nextEp.air_date})
            </div>
          )}

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

          {show.overview && (
            <p className="text-base text-text-secondary leading-relaxed mb-3">{show.overview}</p>
          )}

          {watchlistItem && <NotesBlock notes={watchlistItem.notes} onChange={notes => updateNotes(show.id, notes)} />}
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

      <div className="mb-4">
        <h2 className="text-sm font-bold text-text-secondary mb-2">Säsonger</h2>
        <div className="bg-surface border border-border-main rounded-sm">
          <SeasonList
            tmdbId={show.id}
            seasons={show.seasons}
            isWatched={isWatched}
            markEpisodeWatched={markEpisodeWatched}
            markSeasonWatched={markSeasonWatched}
            getSeasonProgress={getSeasonProgress}
          />
        </div>
      </div>

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

      <ReviewList tmdbId={show.id} mediaType="tv" />

      <RecommendationsSection
        recommendations={mappedRecs}
        myProviders={myProviders}
        label="Liknande serier"
      />
    </div>
  );
}
