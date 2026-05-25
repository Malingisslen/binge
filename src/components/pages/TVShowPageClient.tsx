'use client';

import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp, Tv } from 'lucide-react';
import { useTVShow } from '@/hooks/useTMDB';
import { usePageMeta } from '@/hooks/usePageMeta';
import { JsonLd, tvSchema, breadcrumbSchema } from '@/components/title/JsonLd';
import { posterUrl, profileUrl, logoUrl } from '@/lib/tmdb/client';
import StatusButton from '@/components/title/StatusButton';
import NotInterestedButton from '@/components/title/NotInterestedButton';
import AddToListButton from '@/components/title/AddToListButton';
import AddToGroupButton from '@/components/title/AddToGroupButton';
import RatingStars from '@/components/title/RatingStars';
import ProviderTag from '@/components/title/ProviderTag';
import SeasonList from '@/components/tv/SeasonList';
import NotesBlock from '@/components/title/NotesBlock';
import RecCard from '@/components/recommendations/RecCard';
import ReviewList from '@/components/title/ReviewList';
import { toneForGenreIds } from '@/lib/duotone';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';
import { tvShowStatusLabel } from '@/lib/watchStatus';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { canonicalProviderId } from '@/lib/tmdb/providers';
import ClientOnly from '@/components/utils/ClientOnly';
import type { TMDBTVShow } from '@/types';

export default function TVShowPageClient({ id, initialData }: { id: string; initialData?: TMDBTVShow }) {
  const showId = parseInt(id, 10);
  const searchParams = useSearchParams();
  // Spoiler-skydd-grupp (Fas 2b): GroupWatchlistTable skickar `?fromGroup={id}`
  // när användaren klickar från en grupps watchlist. Vi propagerar det till
  // SeasonList → EpisodeRow så avsnitt utöver gruppens minsta-position maskas.
  const fromGroup = searchParams?.get('fromGroup') ?? null;
  const { data: show, isLoading } = useTVShow(showId, initialData);
  const { getItem, updateRating, updateNotes, updateTmdbStatus } = useWatchlist();
  useAuth();
  const { isWatched, markEpisodeWatched, markSeasonWatched, getSeasonProgress } = useEpisodeProgressWithSync(showId);
  const [showRentBuy, setShowRentBuy] = useState(false);
  // mounted-flag förhindrar hydration mismatch — server och initial-render
  // visar inget auth-state, sedan byter via vanlig state-update efter mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
    // Tar bort catch-all-shellets noindex när TMDB bekräftat att serien finns.
    // Pre-renderade /tv/[id] (topp-N) påverkas inte — egen statisk HTML.
    indexable: !!show,
  });

  const watchlistItem = mounted && show ? getItem(show.id) : null;
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

  if (isLoading) return <div className="text-sm text-ink-3 py-4">Laddar…</div>;
  if (!show) return <div className="text-sm text-ink-3 py-4">Serien hittades inte.</div>;

  const poster = posterUrl(show.poster_path, 'w500');
  const tone = toneForGenreIds(show.genres.map(g => g.id));
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
    <>
      {/* Schema.org structured data — rich snippets + knowledge panel i Google */}
      <JsonLd data={tvSchema(show)} />
      <JsonLd data={breadcrumbSchema([
        { name: 'Binge.nu', url: 'https://binge.nu/' },
        { name: 'Serier', url: 'https://binge.nu/series/' },
        { name: displayTitle, url: `https://binge.nu/tv/${show.id}/` },
      ])} />

      <div className="crumb">Bibliotek · serier · {displayTitle}</div>

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
                <Tv size={48} />
              </div>
            )}
          </div>
        </div>

        <div className="meta-col">
          <div className="chips-line">
            {watchlistItem && (
              <span className="chip acc">
                <span className="dot" />{tvShowStatusLabel(show.status).toLowerCase()}
              </span>
            )}
            <span className="kind">
              SERIE · {yearStart}{yearEnd ? `–${yearEnd}` : '–'}
            </span>
            {genres && <span className="kind">{genres}</span>}
          </div>
          <h1>{displayTitle}</h1>
          {creators.length > 0 && (
            <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)', letterSpacing: 0.04 }}>
              {creators.length === 1 ? 'skapare' : 'skapare'}:{' '}
              {creators.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <Link href={`/person/${c.id}/`} style={{ color: 'var(--ink-2)', textDecoration: 'none', borderBottom: '1px solid var(--rule)' }}>
                    {c.name}
                  </Link>
                </span>
              ))}
            </div>
          )}
          {show.overview && <p className="syn">{show.overview}</p>}
          <div className="stats">
            <span><span className="k">säsonger</span><strong>{show.number_of_seasons}</strong></span>
            {show.number_of_episodes && (
              <span><span className="k">avsnitt</span><strong>{show.number_of_episodes}</strong></span>
            )}
            <span><span className="k">tmdb</span><strong>{show.vote_average.toFixed(1)} / 10</strong></span>
            {imdbId && (
              <span>
                <span className="k">imdb</span>
                <a href={`https://www.imdb.com/title/${imdbId}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px solid var(--rule)' }}>
                  öppna →
                </a>
              </span>
            )}
          </div>

          <ClientOnly>
            <div className="actions-row">
              <StatusButton {...statusButtonProps} />
              <div>
                {watchlistItem && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: 0.12, textTransform: 'uppercase', marginBottom: 3 }}>
                    Ditt betyg
                  </div>
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

      <div style={{ marginTop: 18 }}>
        {nextEp && (
          <div className="chip acc" style={{ padding: '6px 12px' }}>
            Nästa avsnitt: S{nextEp.season_number}E{nextEp.episode_number} — {nextEp.name} ({nextEp.air_date})
          </div>
        )}
        <ClientOnly>
          {watchlistItem?.status === 'sedd' && nextEp && (
            <div style={{
              marginTop: 8,
              padding: '8px 14px',
              background: 'var(--acc-soft)',
              border: '1px solid oklch(0.86 0.08 75)',
              borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              fontSize: 13.5, color: 'var(--ink-2)',
            }}>
              <span>Du har markerat serien som sedd, men nya avsnitt är på väg.</span>
              <StatusButton {...statusButtonProps} />
            </div>
          )}
        </ClientOnly>
      </div>
      {/* Säsonger — episode list + progress (preview surface, raw).
          Säsongs-progress är watchlist-beroende (Firestore) så vi ClientOnly-
          gatear hela sektionen för att inte mismatcha vid hydrering. */}
      <ClientOnly>
        <section className="detail-section">
          <div className="head">
            <h2>Säsonger</h2>
            <span className="meta">{show.number_of_seasons} säsong{show.number_of_seasons !== 1 ? 'er' : ''}</span>
          </div>
          <div style={{ border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--surface)' }}>
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
        </section>
      </ClientOnly>

      {/* Trailer — raw 16:9 video (preview surface) */}
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
            <span className="meta">huvudroller · {cast.length} av {show.credits?.cast?.length ?? cast.length}</span>
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

      {/* Notes + Reviews — auth-beroende, ClientOnly för hydration + SEO. */}
      <ClientOnly>
        {watchlistItem && (
          <section className="detail-section">
            <div className="head">
              <h2>Din anteckning</h2>
            </div>
            <NotesBlock notes={watchlistItem.notes} onChange={notes => updateNotes(show.id, notes)} />
          </section>
        )}
        <section className="detail-section">
          <ReviewList tmdbId={show.id} mediaType="tv" title={displayTitle} posterPath={show.poster_path} />
        </section>
      </ClientOnly>

      {/* Similar series — back to duotone (navigation surface) */}
      {mappedRecs.length > 0 && (
        <section className="detail-section" style={{ borderTop: '1px solid var(--rule)', paddingTop: 28 }}>
          <div className="head">
            <div>
              <h2>Liknande serier</h2>
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
