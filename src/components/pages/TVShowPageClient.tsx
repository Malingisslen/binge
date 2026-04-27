'use client';

import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp, Tv } from 'lucide-react';
import { useTVShow } from '@/hooks/useTMDB';
import { usePageMeta } from '@/hooks/usePageMeta';
import { JsonLd, tvSchema, breadcrumbSchema } from '@/components/title/JsonLd';
import { posterUrl, profileUrl, backdropUrl, logoUrl } from '@/lib/tmdb/client';
import StatusButton from '@/components/title/StatusButton';
import NotInterestedButton from '@/components/title/NotInterestedButton';
import AddToListButton from '@/components/title/AddToListButton';
import AddToGroupButton from '@/components/title/AddToGroupButton';
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
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { canonicalProviderId } from '@/lib/tmdb/providers';

export default function TVShowPageClient({ id }: { id: string }) {
  const showId = parseInt(id, 10);
  const searchParams = useSearchParams();
  // Spoiler-skydd-grupp (Fas 2b): GroupWatchlistTable skickar `?fromGroup={id}`
  // när användaren klickar från en grupps watchlist. Vi propagerar det till
  // SeasonList → EpisodeRow så avsnitt utöver gruppens minsta-position maskas.
  const fromGroup = searchParams?.get('fromGroup') ?? null;
  const { data: show, isLoading } = useTVShow(showId);
  const { getItem, updateRating, updateNotes, updateTmdbStatus } = useWatchlist();
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];
  const { isWatched, markEpisodeWatched, markSeasonWatched, getSeasonProgress } = useEpisodeProgressWithSync(showId);
  const [showRentBuy, setShowRentBuy] = useState(false);

  const mappedRecs = useMemo(
    () => (show?.recommendations?.results?.slice(0, 8) ?? []).map(r => ({ ...r, media_type: 'tv' as const })),
    [show?.recommendations]
  );

  const displayTitle = show ? preferOriginalTitle(show.name, show.original_name) : '';
  const firstYear = show?.first_air_date ? show.first_air_date.slice(0, 4) : '';
  usePageMeta({
    title: displayTitle
      ? `${displayTitle}${firstYear ? ` (${firstYear})` : ''} — var streamar jag?`
      : 'Serie',
    description: show
      ? `${displayTitle}${firstYear ? ` (${firstYear})` : ''}. ${show.overview?.slice(0, 180) ?? 'Se var serien finns att streama i Sverige.'}`
      : undefined,
    ogImage: show?.poster_path ? posterUrl(show.poster_path, 'w500') ?? undefined : undefined,
  });

  const watchlistItem = show ? getItem(show.id) : null;
  const itemExists = !!watchlistItem;
  const cachedTmdbStatus = watchlistItem?.tmdbStatus ?? null;
  const showStatus = show?.status ?? null;
  const showIdForEffect = show?.id ?? null;
  useEffect(() => {
    if (!itemExists || showIdForEffect == null || showStatus == null) return;
    if (cachedTmdbStatus !== showStatus) {
      updateTmdbStatus(showIdForEffect, showStatus);
    }
  }, [itemExists, showIdForEffect, showStatus, cachedTmdbStatus, updateTmdbStatus]);

  if (isLoading) return <div className="text-sm text-text-muted py-4">Laddar...</div>;
  if (!show) return <div className="text-sm text-text-muted py-4">Serien hittades inte.</div>;

  const poster = posterUrl(show.poster_path, 'w500');
  const backdrop = backdropUrl(show.backdrop_path);
  const providers = show['watch/providers']?.results?.SE;
  const flatrate = providers?.flatrate ?? [];
  const free = providers?.free ?? [];
  const ads = providers?.ads ?? [];
  const subscription = [...flatrate, ...free, ...ads];
  const rent = providers?.rent ?? [];
  const buy = providers?.buy ?? [];
  const hasRentBuy = rent.length > 0 || buy.length > 0;
  const yearStart = show.first_air_date?.substring(0, 4) ?? '—';
  const yearEnd = show.status === 'Ended' ? show.last_air_date?.substring(0, 4) : '';
  const genres = show.genres.map(g => g.name).join(', ');
  const cast = show.credits?.cast?.slice(0, 10) ?? [];
  const nextEp = show.next_episode_to_air;
  const creators = show.credits?.crew?.filter(c => c.job === 'Creator' || c.department === 'Creator') ?? [];
  const trailer = show.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer')
    ?? show.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Teaser');
  const imdbId = show.external_ids?.imdb_id;
  const statusButtonProps = {
    tmdbId: show.id,
    mediaType: 'tv' as const,
    title: displayTitle,
    posterPath: show.poster_path,
    releaseYear: parseInt(yearStart, 10) || null,
    totalSeasons: show.number_of_seasons,
    providers: Array.from(new Set([...subscription, ...rent, ...buy].map(p => canonicalProviderId(p.provider_id)))),
    genreIds: show.genres.map(g => g.id),
    tmdbStatus: show.status,
  };

  return (
    <div className="-mt-[14px] -mx-[18px]">
      {/* Schema.org structured data — rich snippets + knowledge panel i Google */}
      <JsonLd data={tvSchema(show)} />
      <JsonLd data={breadcrumbSchema([
        { name: 'Binge.nu', url: 'https://binge.nu/' },
        { name: 'Serier', url: 'https://binge.nu/series/' },
        { name: displayTitle, url: `https://binge.nu/tv/${show.id}/` },
      ])} />

      {/* Hero backdrop */}
      <div className="relative w-full h-[180px] md:h-[280px] bg-[#2a2a2a] overflow-hidden">
        {backdrop && (
          <img
            src={backdrop}
            alt=""
            className="w-full h-full object-cover object-[center_20%] opacity-60"
            loading="eager"
            decoding="async"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-page via-page/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 px-[18px] pb-4 flex gap-4 items-end">
          {poster ? (
            <img src={poster} alt={displayTitle} className="w-[100px] md:w-[140px] rounded-sm shadow-lg shrink-0 relative z-10" loading="eager" decoding="async" width={140} height={210} />
          ) : (
            <div className="w-[100px] md:w-[140px] aspect-[2/3] bg-[#ddd8d0] rounded-sm shrink-0 flex items-center justify-center">
              <Tv size={32} className="text-text-muted" />
            </div>
          )}
          <div className="relative z-10 pb-1">
            <h1 className="text-[22px] md:text-[28px] font-bold text-text-primary leading-tight mb-1">{displayTitle}</h1>
            <div className="text-sm text-text-secondary">
              {yearStart}{yearEnd ? `–${yearEnd}` : '-'} · {show.number_of_seasons} säsong{show.number_of_seasons !== 1 ? 'er' : ''} · {genres}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-[18px] pt-4">
        {/* Creator + status */}
        {creators.length > 0 && (
          <div className="text-xs text-text-muted mb-1">
            Skapare: {creators.map((c, i) => (
              <span key={c.id}>{i > 0 && ', '}<Link href={`/person/${c.id}/`} className="text-text-secondary no-underline hover:text-accent">{c.name}</Link></span>
            ))}
          </div>
        )}
        <div className="text-xs text-text-muted mb-3">
          Status: {tvShowStatusLabel(show.status)} · TMDB: {show.vote_average.toFixed(1)}/10
          {imdbId && (
            <a href={`https://www.imdb.com/title/${imdbId}`} target="_blank" rel="noopener noreferrer" className="text-text-muted ml-2 no-underline hover:text-accent">IMDb</a>
          )}
        </div>

        {/* CTA actions — prominent */}
        <div className="flex items-center gap-3 mb-4">
          <StatusButton {...statusButtonProps} />
          <div>
            {watchlistItem && (
              <div className="text-xxs text-text-muted mb-[2px]">Ditt betyg</div>
            )}
            <RatingStars
              rating={watchlistItem?.rating ?? null}
              onChange={r => watchlistItem && updateRating(show.id, r)}
              readonly={!watchlistItem}
              size="lg"
            />
          </div>
          <AddToListButton tmdbId={show.id} mediaType="tv" title={displayTitle} posterPath={show.poster_path} />
          <AddToGroupButton
            tmdbId={show.id}
            mediaType="tv"
            title={displayTitle}
            posterPath={show.poster_path}
            releaseYear={show.first_air_date ? parseInt(show.first_air_date.substring(0, 4), 10) : null}
          />
          <NotInterestedButton tmdbId={show.id} mediaType="tv" title={displayTitle} />
        </div>

        {/* Next episode */}
        {nextEp && (
          <div className="text-sm text-text-secondary mb-3 bg-surface border border-border-main rounded-sm px-3 py-2">
            Nästa avsnitt: <span className="font-semibold">S{nextEp.season_number}E{nextEp.episode_number}</span> — {nextEp.name} ({nextEp.air_date})
          </div>
        )}

        {watchlistItem?.status === 'sedd' && nextEp && (
          <div className="text-sm mb-3 bg-accent/[0.04] border border-accent/40 rounded-sm px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-text-secondary">
              Du har markerat serien som sedd, men nya avsnitt är på väg.
            </span>
            <StatusButton {...statusButtonProps} />
          </div>
        )}

        {/* Providers — streaming prominent, rent/buy collapsed */}
        {(subscription.length > 0 || hasRentBuy) && (
          <div className="mb-4 bg-surface border border-border-main rounded-sm p-3">
            {subscription.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xxs text-text-muted uppercase tracking-[0.5px] font-semibold">Streama:</span>
                {subscription.map(p => {
                  const logo = logoUrl(p.logo_path);
                  return logo ? (
                    <img key={p.provider_id} src={logo} alt={p.provider_name} title={p.provider_name} className="w-[28px] h-[28px] rounded-sm" loading="lazy" decoding="async" width={28} height={28} />
                  ) : (
                    <ProviderTag key={p.provider_id} provider={p} size="md" />
                  );
                })}
              </div>
            )}
            {hasRentBuy && (
              <>
                {subscription.length > 0 && <div className="border-t border-border-light my-2" />}
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
        {show.overview && (
          <div className="mb-4">
            <h2 className="text-sm font-bold text-text-secondary pb-1 border-b border-border-main mb-2">Handling</h2>
            <p className="text-sm text-text-secondary leading-relaxed">{show.overview}</p>
          </div>
        )}

        {watchlistItem && <NotesBlock notes={watchlistItem.notes} onChange={notes => updateNotes(show.id, notes)} />}

        {/* Seasons */}
        <div className="mb-4">
          <h2 className="text-sm font-bold text-text-secondary pb-1 border-b border-border-main mb-2">Säsonger</h2>
          <div className="bg-surface border border-border-main rounded-sm">
            <SeasonList
              tmdbId={show.id}
              seasons={show.seasons}
              isWatched={isWatched}
              markEpisodeWatched={markEpisodeWatched}
              markSeasonWatched={markSeasonWatched}
              getSeasonProgress={getSeasonProgress}
              fromGroup={fromGroup}
            />
          </div>
        </div>

        {/* Trailer */}
        {trailer && (
          <div className="mb-4">
            <h2 className="text-sm font-bold text-text-secondary pb-1 border-b border-border-main mb-2">Trailer</h2>
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

        {/* Cast with round images */}
        {cast.length > 0 && (
          <div className="mb-4">
            <h2 className="text-sm font-bold text-text-secondary pb-1 border-b border-border-main mb-2">Skådespelare</h2>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {cast.map(person => (
                <Link key={person.id} href={`/person/${person.id}/`} className="shrink-0 w-[70px] no-underline text-text-primary">
                  {profileUrl(person.profile_path) ? (
                    <img
                      src={profileUrl(person.profile_path)!}
                      alt={person.name}
                      className="w-[50px] h-[50px] object-cover rounded-full mb-[4px] mx-auto"
                      loading="lazy"
                      decoding="async"
                      width={50}
                      height={50}
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

        <ReviewList tmdbId={show.id} mediaType="tv" title={displayTitle} posterPath={show.poster_path} />

        <RecommendationsSection
          recommendations={mappedRecs}
          myProviders={myProviders}
          label="Liknande serier"
        />
      </div>
    </div>
  );
}
