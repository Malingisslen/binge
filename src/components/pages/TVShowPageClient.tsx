'use client';

import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp, Tv } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTVShow } from '@/hooks/useTMDB';
import { currentSeasonToPrefetch, seasonPrefetchSpec } from '@/lib/tmdb/prefetch';
import { usePageMeta } from '@/hooks/usePageMeta';
import { JsonLd, tvSchema, breadcrumbSchema } from '@/components/title/JsonLd';
import { posterUrl, profileUrl, logoUrl } from '@/lib/tmdb/client';
import StatusButton from '@/components/title/StatusButton';
import NotInterestedButton from '@/components/title/NotInterestedButton';
import AddToListButton from '@/components/title/AddToListButton';
import AddToGroupButton from '@/components/title/AddToGroupButton';
import RatingStars from '@/components/title/RatingStars';
import CommunityRating from '@/components/title/CommunityRating';
import ProviderTag from '@/components/title/ProviderTag';
import FreeWatchBadge from '@/components/title/FreeWatchBadge';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import RecapPanel from '@/components/title/RecapPanel';
import { contiguousWatchedBoundary, inventoryFromSeasons } from '@/lib/recaps/progress';
import TrailerSection from '@/components/ui/TrailerSection';
import { LoadingView } from '@/components/ui/LoadingView';
import { AvatarInitials } from '@/components/ui/AvatarInitials';
import SeasonList from '@/components/tv/SeasonList';
import { seasonCompletion } from '@/lib/tmdb/seasonCompletion';
import NotesBlock from '@/components/title/NotesBlock';
import TagEditor from '@/components/title/TagEditor';
import { tagsInLibrary } from '@/lib/libraryView';
import RecCard from '@/components/recommendations/RecCard';
import ReviewList from '@/components/title/ReviewList';
import { toneForGenreIds } from '@/lib/duotone';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useTitleRatings } from '@/hooks/useTitleRatings';
import { RatingsRow } from '@/components/title/RatingsRow';
import FriendsWhoSaw from '@/components/title/FriendsWhoSaw';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';
import { tvShowStatusLabel } from '@/lib/watchStatus';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { buildContentFloor } from '@/lib/seo/contentFloor';
import { tvContentFloorInput } from '@/lib/seo/contentFloorInput';
import { formatNextEpisodeLabel } from '@/lib/episodeLabel';
import { canonicalProviderId, dedupeProvidersByCanonicalId, affiliateWrap } from '@/lib/tmdb/providers';
import ClientOnly from '@/components/utils/ClientOnly';
import { useStreamingOffers } from '@/hooks/useStreamingOffers';
import { CheapestPathVerdict } from '@/components/title/CheapestPathVerdict';
import PriceHistoryChart from '@/components/title/PriceHistoryChart';
import { offerForProvider, isLeavingSoon, formatLeaving } from '@/lib/streaming/offers';
import type { TMDBTVShow } from '@/types';

export default function TVShowPageClient({ id, initialData }: { id: string; initialData?: TMDBTVShow }) {
  const showId = parseInt(id, 10);
  const searchParams = useSearchParams();
  // Spoiler-skydd-grupp (Fas 2b): GroupWatchlistTable skickar `?fromGroup={id}`
  // när användaren klickar från en grupps watchlist. Vi propagerar det till
  // SeasonList → EpisodeRow så avsnitt utöver gruppens minsta-position maskas.
  const fromGroup = searchParams?.get('fromGroup') ?? null;
  // BINGE-9: en skräp-URL som /tv/undefined ger showId=NaN. Skicka null då så
  // TMDB-anropet aldrig avfyras (undviker 404 → Sentry) och sidan faller ner
  // till "Serien hittades inte." nedan.
  const { data: show, isLoading } = useTVShow(Number.isFinite(showId) ? showId : null, initialData);
  const { offers } = useStreamingOffers(show?.id);
  const { getItem, updateRating, updateNotes, updateTmdbStatus, setRuntime, refreshTmdbFields, updateTags, items } = useWatchlist();
  const { user } = useAuth();
  const ratings = useTitleRatings(show?.external_ids?.imdb_id);
  const { isWatched, markEpisodeWatched, markSeasonWatched, markSeasonUnwatched, getSeasonProgress } = useEpisodeProgressWithSync(showId);
  const [showRentBuy, setShowRentBuy] = useState(false);
  // mounted-flag förhindrar hydration mismatch — server och initial-render
  // visar inget auth-state, sedan byter via vanlig state-update efter mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Prefetcha aktuell säsong i bakgrunden så SeasonList renderar direkt
  // utan spinner när användaren expanderar den. Gate:at på `show` internt
  // så att hooken kan ligga här, före early returns (Rules of Hooks).
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!show) return;
    const season = currentSeasonToPrefetch(show);
    if (season == null) return;
    void queryClient.prefetchQuery(seasonPrefetchSpec(show.id, season));
  }, [show, queryClient]);

  // BIN-93: lazily backfill per-episode runtime onto the watchlist doc (free —
  // from the detail already fetched). No-ops unless in-library + runtime unknown.
  const showRuntime = show?.episode_run_time?.[0] ?? null;
  useEffect(() => {
    if (!mounted || !show || showRuntime == null) return;
    void setRuntime(show.id, showRuntime);
  }, [mounted, show, showRuntime, setRuntime]);

  // BIN-402: lazy-refresh the denormalized TMDB block from the detail we already
  // have (free). No-ops unless the title is in the library AND its freshness stamp
  // is absent (swept clean) or older than the refresh interval — repopulates a
  // swept doc and keeps a viewed title from reaching the sweep's clear threshold.
  // Never bumps updatedAt.
  useEffect(() => {
    if (!mounted || !show) return;
    const se = show['watch/providers']?.results?.SE;
    // Only send providers when the SE block is actually present — an absent block
    // must not clobber good denormalized ids with [].
    const providerIds = se
      ? Array.from(new Set(
          [...(se.flatrate ?? []), ...(se.free ?? []), ...(se.ads ?? []), ...(se.rent ?? []), ...(se.buy ?? [])]
            .map(p => canonicalProviderId(p.provider_id)),
        ))
      : undefined;
    void refreshTmdbFields(show.id, {
      // Match what addItem/StatusButton denormalize (preferOriginalTitle) so the
      // refresh never overwrites a correct original title with the localized one.
      title: preferOriginalTitle(show.name, show.original_name) || undefined,
      posterPath: show.poster_path,
      providers: providerIds,
      genreIds: show.genres?.map(g => g.id),
      tmdbStatus: show.status,
      runtime: showRuntime,
    });
  }, [mounted, show, showRuntime, refreshTmdbFields]);

  // T6: räknaren ("N förslag") och griden måste visa samma antal — skär till 5
  // (= similar-grid:s desktop-kolumner) redan här, istället för 8 i memo:t +
  // slice(0, 5) i render som gav "8 förslag" med 5 synliga kort.
  const mappedRecs = useMemo(
    () => (show?.recommendations?.results?.slice(0, 5) ?? []).map(r => ({ ...r, media_type: 'tv' as const })),
    [show?.recommendations]
  );

  // BIN-185: the spoiler-safe recap boundary — the contiguous watched frontier over the show's
  // episode inventory, from the page's existing isWatched (so RecapPanel opens no second
  // episodeProgress listener). Null-safe on show so this hook runs before the loading guard.
  const recapBoundary = useMemo(
    () => contiguousWatchedBoundary(inventoryFromSeasons(show?.seasons), isWatched),
    [show?.seasons, isWatched]
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

  if (isLoading) return <LoadingView variant="detail" label="Laddar serien…" />;
  if (!show) return <div className="text-sm text-ink-3 py-4">Serien hittades inte.</div>;

  const poster = posterUrl(show.poster_path, 'w500');
  const tone = toneForGenreIds(show.genres.map(g => g.id));
  const providers = show['watch/providers']?.results?.SE;
  const flatrate = providers?.flatrate ?? [];
  const free = providers?.free ?? [];
  const ads = providers?.ads ?? [];
  // Dedup på kanoniskt id — annars visas t.ex. Max + "HBO Max Amazon
  // Channel" som två logotyper för samma tjänst (T1).
  const subscription = dedupeProvidersByCanonicalId([...flatrate, ...free, ...ads]);
  // BIN-155: "finns på"-raden visar bara flatrate; gratis/AVOD visas i
  // FreeWatchBadge, inte dubbelt. `subscription` (allt) behålls för JustWatch-villkoret.
  const onSubscription = dedupeProvidersByCanonicalId(flatrate);
  // BIN-209: cheapest-path får flatrate+free (riktiga abonnemang/public-service),
  // INTE ads/AVOD — annars föreslår 'subscribe'/'owned' en gratis-med-reklam-tjänst.
  const subForVerdict = dedupeProvidersByCanonicalId([...flatrate, ...free]);
  const rent = providers?.rent ?? [];
  const buy = providers?.buy ?? [];
  const hasRentBuy = rent.length > 0 || buy.length > 0;
  const yearStart = show.first_air_date?.substring(0, 4) ?? '—';
  const yearEnd = show.status === 'Ended' ? show.last_air_date?.substring(0, 4) : '';
  const genres = show.genres.map(g => g.name).join(', ');
  const cast = show.credits?.cast?.slice(0, 10) ?? [];
  // BIN-187 — "Samla klart" (seasons leg): how many of this show's seasons the
  // user has fully completed. Cheap O(seasons) derive, so computed inline (not
  // memoised) to always reflect the latest episode progress.
  const seasonMeter = seasonCompletion(show.seasons, (s, ec) => getSeasonProgress(s, ec).watched);
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
  // Hoisted here (not inside JSX) so the linter disable is minimal in scope.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

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
              <img src={poster} alt={displayTitle} loading="eager" fetchPriority="high" decoding="async" width={342} height={513} />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--placeholder-fill)',
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
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)', letterSpacing: 0.04 }}>
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
          {show.overview
            ? <p className="syn">{show.overview}</p>
            : <p className="syn">{buildContentFloor(tvContentFloorInput(show)).paragraph}</p>}
          <div className="stats">
            <span><span className="k">säsonger</span><strong>{show.number_of_seasons}</strong></span>
            {show.number_of_episodes && (
              <span><span className="k">avsnitt</span><strong>{show.number_of_episodes}</strong></span>
            )}
            <CommunityRating mediaType="tv" tmdbId={show.id} />
          </div>
          <RatingsRow ratings={ratings} imdbId={imdbId ?? ''} tmdb={show.vote_average} />

          <ClientOnly>
            <FriendsWhoSaw tmdbId={show.id} />
          </ClientOnly>

          <ClientOnly>
            <div className="actions-row">
              <StatusButton {...statusButtonProps} />
              <div>
                {watchlistItem && (
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: 0.12, textTransform: 'uppercase', marginBottom: 3 }}>
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

          {mounted && (
            <CheapestPathVerdict
              subscriptionProviderIds={subForVerdict.map(p => canonicalProviderId(p.provider_id))}
              ownedProviderIds={user?.myProviders ?? []}
              offers={offers}
              libraryAvailable={false}
            />
          )}

          {(onSubscription.length > 0 || hasRentBuy) && (
            <div className="providers-row">
              {onSubscription.length > 0 && <span className="lab">finns på</span>}
              {onSubscription.map(p => {
                const logo = logoUrl(p.logo_path);
                const offer = offerForProvider(offers, canonicalProviderId(p.provider_id));
                if (logo) {
                  // Placeholder-bakgrund + eager: raden är above-the-fold och
                  // utan fill renderas tomma vita rutor tills CDN:t svarar (T5).
                  const leaving = isLeavingSoon(offer, now);
                  const leavingLabel = leaving ? formatLeaving(offer!) : null;
                  const imgEl = (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt={p.provider_name} title={p.provider_name} style={{ width: 28, height: 28, borderRadius: 3, border: '1px solid var(--rule)', background: 'var(--placeholder-fill)' }} loading="eager" decoding="async" width={28} height={28} />
                  );
                  return (
                    <span key={p.provider_id} className="inline-flex items-center gap-1">
                      {offer?.link ? (
                        <a href={affiliateWrap(p.provider_id, offer.link)} target="_blank" rel="noopener noreferrer">{imgEl}</a>
                      ) : imgEl}
                      {leavingLabel && (
                        <span className="rounded-sm bg-acc-soft text-acc-deep px-1 text-[11px]">{leavingLabel}</span>
                      )}
                    </span>
                  );
                }
                return <ProviderTag key={p.provider_id} provider={p} size="md" offer={offer} nowMs={now} />;
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

          <FreeWatchBadge free={free} ads={ads} />

          {showRentBuy && hasRentBuy && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-3)' }}>
              {rent.length > 0 && (
                <div>
                  <span style={{ letterSpacing: 0.12, textTransform: 'uppercase', marginRight: 6 }}>Hyr:</span>
                  {rent.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" offer={offerForProvider(offers, canonicalProviderId(p.provider_id))} nowMs={now} />)}
                </div>
              )}
              {buy.length > 0 && (
                <div>
                  <span style={{ letterSpacing: 0.12, textTransform: 'uppercase', marginRight: 6 }}>Köp:</span>
                  {buy.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" offer={offerForProvider(offers, canonicalProviderId(p.provider_id))} nowMs={now} />)}
                </div>
              )}
              {/* BIN-354: rent price-history stat row, same as the film page —
                  lazy (only when this disclosure is open). */}
              <PriceHistoryChart tmdbId={show.id} nowMs={now} />
            </div>
          )}

          {(subscription.length > 0 || hasRentBuy) && (
            <div style={{ marginTop: 8 }}>
              <JustWatchCredit />{' · '}<span className="text-ink-3 text-[11px]">Tillgänglighet via Movie of the Night</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        {nextEp && (
          <div className="chip acc" style={{ padding: '6px 12px' }}>
            Nästa avsnitt: {formatNextEpisodeLabel(nextEp)}
          </div>
        )}
        <ClientOnly>
          {watchlistItem?.status === 'sedd' && nextEp && (
            <div style={{
              marginTop: 8,
              padding: '8px 14px',
              background: 'var(--acc-soft)',
              border: '1px solid var(--rule)',
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
        {/* BIN-185: spoiler-safe recap, shown only when one is cached for the user's boundary. */}
        {watchlistItem && <RecapPanel tmdbId={show.id} boundary={recapBoundary} />}
        <section className="detail-section">
          <div className="head">
            <h2>Säsonger</h2>
            <span className="meta">{show.number_of_seasons} säsong{show.number_of_seasons !== 1 ? 'er' : ''}</span>
          </div>
          {watchlistItem && seasonMeter.total >= 2 && (
            <div className="mb-3 max-w-sm">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-bold text-ink-2">
                  Samla klart — du har sett {seasonMeter.seen} av {seasonMeter.total} säsonger
                </span>
                <span className="text-ink-3">{seasonMeter.pct}%</span>
              </div>
              <div
                className="h-[3px] bg-rule rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={seasonMeter.pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Säsonger du har sett klart: ${seasonMeter.seen} av ${seasonMeter.total}`}
              >
                <div className="h-full bg-ink rounded-full" style={{ width: `${seasonMeter.pct}%` }} />
              </div>
            </div>
          )}
          <div style={{ border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--surface)' }}>
            <SeasonList
              tmdbId={show.id}
              seasons={show.seasons}
              isWatched={isWatched}
              markEpisodeWatched={markEpisodeWatched}
              markSeasonWatched={markSeasonWatched}
              markSeasonUnwatched={markSeasonUnwatched}
              getSeasonProgress={getSeasonProgress}
              fromGroup={fromGroup}
            />
          </div>
        </section>
      </ClientOnly>

      {/* Trailer — raw 16:9 video (preview surface). Döljs helt när embed saknas/failar (M1). */}
      <TrailerSection video={trailer} />

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
                    <AvatarInitials name={person.name} size={72} />
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.25 }}>{person.name}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.2 }}>
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
            <TagEditor
              tags={watchlistItem.tags ?? []}
              onChange={t => updateTags(show.id, t)}
              suggestions={tagsInLibrary(items)}
            />
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
            {mappedRecs.map(rec => (
              <RecCard key={`${rec.media_type}-${rec.id}`} item={rec} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
