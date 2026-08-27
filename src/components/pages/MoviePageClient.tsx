'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Film } from 'lucide-react';
import { useMovie } from '@/hooks/useTMDB';
import { usePageMeta } from '@/hooks/usePageMeta';
import { JsonLd, movieSchema, breadcrumbSchema } from '@/components/title/JsonLd';
import { posterUrl, profileUrl, logoUrl } from '@/lib/tmdb/client';
import StatusButton from '@/components/title/StatusButton';
import WatchedDateEditor from '@/components/title/WatchedDateEditor';
import NotInterestedButton from '@/components/title/NotInterestedButton';
import AddToListButton from '@/components/title/AddToListButton';
import AddToGroupButton from '@/components/title/AddToGroupButton';
import RatingStars from '@/components/title/RatingStars';
import CommunityRating from '@/components/title/CommunityRating';
import ProviderTag from '@/components/title/ProviderTag';
import FreeWatchBadge from '@/components/title/FreeWatchBadge';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import TrailerSection from '@/components/ui/TrailerSection';
import { LoadingView } from '@/components/ui/LoadingView';
import { NotFound } from '@/components/ui/NotFound';
import { AvatarInitials } from '@/components/ui/AvatarInitials';
import NotesBlock from '@/components/title/NotesBlock';
import TagEditor from '@/components/title/TagEditor';
import { tagsInLibrary } from '@/lib/libraryView';
import { buildWatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import RecCard from '@/components/recommendations/RecCard';
import CollectionSection from '@/components/title/CollectionSection';
import CompanionSection from '@/components/franchise/CompanionSection';
import FriendsWhoSaw from '@/components/title/FriendsWhoSaw';
import ReviewList from '@/components/title/ReviewList';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useSignedOutRedirect } from '@/hooks/useSignedOutRedirect';
import { useTitleRatings } from '@/hooks/useTitleRatings';
import { RatingsRow } from '@/components/title/RatingsRow';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { buildContentFloor, hasSubstantialText } from '@/lib/seo/contentFloor';
import { movieContentFloorInput } from '@/lib/seo/contentFloorInput';
import { franchiseByCollectionId } from '@/lib/seo/franchises';
import { canonicalProviderId, dedupeProvidersByCanonicalId, affiliateWrap } from '@/lib/tmdb/providers';
import { seProviderIdsForRefresh, seSubscriptionProviderIdsForRefresh } from '@/lib/tmdb/seProviderIds';
import { toneForGenreIds } from '@/lib/duotone';
import ClientOnly from '@/components/utils/ClientOnly';
import { useStreamingOffers } from '@/hooks/useStreamingOffers';
import { offerForProvider, isLeavingSoon, formatLeaving } from '@/lib/streaming/offers';
import { useCineasternaCatalog } from '@/hooks/useCineasternaCatalog';
import { CheapestPathVerdict } from '@/components/title/CheapestPathVerdict';
import CinemaCountdownStrip from '@/components/title/CinemaCountdownStrip';
import PriceHistoryChart from '@/components/title/PriceHistoryChart';
import { cinemaToStreaming } from '@/lib/calendar/releaseDate';
import { useToast } from '@/contexts/ToastContext';
import type { TMDBMovie } from '@/types';
import { isDeletionInProgressError } from '@/lib/deletionInProgressError';

// Direction H movie-detail page. Same duotone/raw boundary as TV detail:
//   - Hero poster → duotone (identification)
//   - Trailer + cast portraits → raw (preview)
//   - Recommendations at bottom → duotone (back to navigation)

export default function MoviePageClient({ id, initialData }: { id: string; initialData?: TMDBMovie }) {
  const movieId = parseInt(id, 10);
  // BINGE-9: en skräp-URL som /movie/undefined ger movieId=NaN. Skicka null då
  // så TMDB-anropet aldrig avfyras (undviker 404 → Sentry) och sidan faller ner
  // till "Filmen hittades inte." nedan.
  const { data: movie, isLoading } = useMovie(Number.isFinite(movieId) ? movieId : null, initialData);
  const { offers } = useStreamingOffers(movie?.id, 'movie');
  const cineasterna = useCineasternaCatalog();
  const { getItem, upsertTitle, updateRating, updateNotes, updateWatchedAt, setRuntime, refreshTmdbFields, updateTags, items, loading: watchlistLoading, libraryKnown } = useWatchlist();
  const { user, uid, loading: authLoading } = useAuth();
  // BIN-731: a signed-out tap on the countdown strip's "Bevaka släpp" goes to
  // /login and comes back — the same answer StatusButton/QuickAddButton give
  // (BIN-714/645). Keyed on `uid` (the auth verdict), never on `user` (the
  // Firestore profile), which stays null for a signed-in visitor whose profile
  // read failed — BIN-645's bug.
  const goToLogin = useSignedOutRedirect();
  const signedOut = !authLoading && uid == null;
  const { show: toast } = useToast();
  const ratings = useTitleRatings(movie?.imdb_id);
  const [showRentBuy, setShowRentBuy] = useState(false);
  // mounted-flag förhindrar hydration mismatch: SSR/initial-render visar inget
  // watchlist-state (eftersom Firebase/localStorage inte finns på server), och
  // efter mount byter den till riktiga värdet. Det matchar också SEO-intentet:
  // Googlebot ska inte se "i biblioteket"-chip eller stjärnbetyg i HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // BIN-93: lazily backfill runtime onto the watchlist doc from the detail we
  // already fetched (free — no extra request). setRuntime no-ops unless the
  // title is in the library and runtime is still unknown.
  //
  // `watchlistLoading` is load-bearing in BOTH the guard and the deps. setRuntime
  // looks the title up in the live snapshot and early-returns when it is not
  // there — and on a hard page load the snapshot always lands AFTER `mounted`
  // flips, so without this gate the backfill can run once against an empty
  // library and never fire again. It also stops a previous account's stale items
  // from deciding the write across a uid switch. Same pattern as
  // CollectionSection/CompanionSection.
  //
  // NOTE (2026-08-04): BIN-598 has now LANDED, and `setRuntime` was deliberately
  // left OUT of its itemsRef migration — it still closes over `items` and still
  // gets a fresh identity per snapshot, because that reactivity is what re-fires
  // this backfill. So the previous note's "when BIN-598 lands the gate becomes
  // load-bearing on its own" never arrives for this effect: it stays
  // belt-and-braces. The operational advice is unchanged — do not remove it as
  // redundant on the way past.
  const movieRuntime = movie?.runtime ?? null;
  useEffect(() => {
    if (!mounted || watchlistLoading || !movie || movieRuntime == null) return;
    void setRuntime('movie', movie.id, movieRuntime);
  }, [mounted, watchlistLoading, movie, movieRuntime, setRuntime]);

  // BIN-402: lazy-refresh the denormalized TMDB block from the detail we already
  // have (free — no extra request). No-ops unless the title is in the library AND
  // its freshness stamp is absent (swept clean / never stamped) or older than the
  // refresh interval — repopulates a swept doc and keeps a viewed title from ever
  // reaching the ToS sweep's 5-month clear threshold. Never bumps updatedAt.
  // Gated on `watchlistLoading` for the same reason as the runtime backfill above.
  useEffect(() => {
    if (!mounted || watchlistLoading || !movie) return;
    // BIN-468: shared with TVShowPageClient. Returns undefined for an ABSENT SE
    // block (so it can never clobber good denormalized ids) and [] for a present
    // but empty one — see seProviderIds.ts for why that distinction is load-bearing.
    const providerIds = seProviderIdsForRefresh(movie);
    // BIN-814: the subscription-only subset, from the SAME detail object, so the
    // advisor's answer and the availability answer can never come from different fetches.
    const subscriptionProviderIds = seSubscriptionProviderIdsForRefresh(movie);
    void refreshTmdbFields('movie', movie.id, {
      // Match what upsertTitle/StatusButton denormalize (preferOriginalTitle) so the
      // refresh never overwrites a correct original title with the localized one.
      title: preferOriginalTitle(movie.title, movie.original_title) || undefined,
      posterPath: movie.poster_path,
      providers: providerIds,
      subscriptionProviders: subscriptionProviderIds,
      genreIds: movie.genres?.map(g => g.id),
      runtime: movieRuntime,
    });
  }, [mounted, watchlistLoading, movie, movieRuntime, refreshTmdbFields]);

  // T6 (samma mönster som TVShowPageClient): räknaren och griden måste visa
  // samma antal — skär till 5 direkt så "N förslag" är ärligt.
  const mappedRecs = useMemo(
    () => (movie?.recommendations?.results?.slice(0, 5) ?? []).map(r => ({ ...r, media_type: 'movie' as const })),
    [movie?.recommendations]
  );

  const displayTitle = movie ? preferOriginalTitle(movie.title, movie.original_title) : '';
  const releaseYear = movie?.release_date ? movie.release_date.slice(0, 4) : '';
  // BIN-656: same content floor as the pre-rendered /movie/[id] metadata — the
  // real overview when there is one, else an availability-led Swedish sentence.
  // The old template appended `overview?.slice(…) ?? fallback`, and TMDB's sv-SE
  // answer for an untranslated film is an EMPTY STRING, not null — so `??` never
  // fired and those pages shipped a bare "Titel (år)." description.
  // BIN-688: ONE floor per render, shared by the meta description and the visible
  // fallback paragraph below. They used to be two independent calls, so a future
  // input that varied between them could have described the same film two ways.
  const contentFloor = useMemo(
    () => (movie ? buildContentFloor(movieContentFloorInput(movie)) : undefined),
    [movie],
  );
  usePageMeta({
    title: displayTitle
      ? `${displayTitle}${releaseYear ? ` (${releaseYear})` : ''} — var streamar jag?`
      : 'Film',
    description: contentFloor?.description,
    ogImage: movie?.poster_path ? posterUrl(movie.poster_path, 'w500') ?? undefined : undefined,
    // Tar bort catch-all-shellets noindex när TMDB bekräftat att filmen finns.
    // Pre-renderade /movie/[id] (topp-N) påverkas inte — de har egen statisk
    // HTML med generateMetadata och passerar aldrig catch-all-shellet.
    indexable: !!movie,
  });

  if (isLoading) return <LoadingView variant="detail" label="Laddar filmen…" />;
  if (!movie) return <NotFound crumb="Film" title="Filmen hittades inte." body="Vi kunde inte hitta den här filmen i TMDB." />;

  // BIN-422: känd franchise → statisk, crawlbar /billigaste-länk (renderas
  // utanför ClientOnly nedan). Härledd ur build-initialData, inte ur den
  // klient-hämtade collection-fetchen, så den finns i den statiska HTML:en.
  const franchise = movie.belongs_to_collection
    ? franchiseByCollectionId(movie.belongs_to_collection.id)
    : undefined;

  const onCineasterna = cineasterna.has(movie.id);
  const cineRental = cineasterna.rentalFor(movie.id);
  const watchlistItem = mounted ? getItem('movie', movie.id) : undefined;
  const poster = posterUrl(movie.poster_path, 'w500');
  const tone = toneForGenreIds(movie.genres.map(g => g.id));
  const providers = movie['watch/providers']?.results?.SE;
  const flatrate = providers?.flatrate ?? [];
  const free = providers?.free ?? [];
  const ads = providers?.ads ?? [];
  // Dedup på kanoniskt id — annars visas t.ex. Max + "HBO Max Amazon
  // Channel" som två logotyper för samma tjänst (M2).
  const subscription = dedupeProvidersByCanonicalId([...flatrate, ...free, ...ads]);
  // BIN-155: "finns på"-raden visar BARA flatrate — gratis/AVOD-tjänster visas i
  // FreeWatchBadge ("Gratis"/"Gratis med reklam"), inte dubbelt som logotyp här.
  // `subscription` (allt) behålls för StatusButton-lagring + JustWatch-villkoret.
  const onSubscription = dedupeProvidersByCanonicalId(flatrate);
  // BIN-209: cheapest-path får flatrate+free (riktiga abonnemang/public-service),
  // INTE ads/AVOD — annars föreslår 'subscribe'/'owned' en gratis-med-reklam-tjänst.
  const subForVerdict = dedupeProvidersByCanonicalId([...flatrate, ...free]);
  const rent = providers?.rent ?? [];
  const buy = providers?.buy ?? [];
  const hasRentBuy = rent.length > 0 || buy.length > 0;
  // BIN-98 v1 — hyr↔abonnemang-korsreferens. TMDB ger inga priser, så v1 är ren
  // korsreferens: finns titeln även på abonnemang behöver man oftast inte hyra.
  // Förstärks när det är en tjänst användaren redan har (ren besparing).
  const myProviderIds = mounted ? (user?.myProviders ?? []) : [];
  const subsYouOwn = onSubscription.filter(p => myProviderIds.includes(canonicalProviderId(p.provider_id)));
  const year = movie.release_date?.substring(0, 4) ?? '—';
  // BIN-735 — see the paragraph render below. Any non-blank overview is the
  // film's own words and is always shown; the generated floor sentence is added
  // whenever those words are too thin to carry the page by themselves (which is
  // exactly when the meta description falls back to the floor as well).
  const overviewText = movie.overview?.trim() ? movie.overview : null;
  const needsContentFloorParagraph = !hasSubstantialText(movie.overview);
  const genres = movie.genres.map(g => g.name).join(', ');
  const cast = movie.credits?.cast?.slice(0, 10) ?? [];
  const directors = movie.credits?.crew?.filter(c => c.job === 'Director') ?? [];
  const writers = movie.credits?.crew?.filter(c => c.job === 'Screenplay' || c.job === 'Writer') ?? [];
  const trailer = movie.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer')
    ?? movie.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Teaser');
  // Hoisted here (not inside JSX) so the linter disable is minimal in scope.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  // BIN-193: cinema→streaming countdown. todayStr derives from `now` (pure —
  // no argless Date) so no extra purity-disable. Null unless the film is in
  // Swedish cinemas with a known future digital date.
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const cinemaInfo = cinemaToStreaming(movie, todayStr);

  // BIN-814: the two provider answers, derived ONCE from the same offer buckets and
  // shared by every write path on this page (StatusButton, the "Bevaka släpp" CTA).
  // Derived once on purpose: the movie page previously spelled the broad list out at
  // each call site, and the StatusButton one was missed when the subset was added —
  // so the app's default way to add a film wrote only half the pair, and the fresh
  // providersCheckedAt stamp then gated the repair out for 60 days. TVShowPageClient
  // already hoists its equivalent into one `statusButtonProps` object; this matches it.
  const allProviderIds = Array.from(new Set([...subscription, ...rent, ...buy].map(p => canonicalProviderId(p.provider_id))));
  const subscriptionProviderIdsForMovie = Array.from(new Set(subscription.map(p => canonicalProviderId(p.provider_id))));

  const handleBevaka = () => {
    void upsertTitle(buildWatchlistAddPayload({
      tmdbId: movie.id,
      mediaType: 'movie',
      status: 'vill_se',
      title: displayTitle,
      posterPath: movie.poster_path,
      releaseYear: parseInt(year, 10) || null,
      // Carries rating/progress forward if this somehow runs on a tracked title.
      // NOT the cold-load defence — the CTA is gated on `libraryKnown` for that
      // (BIN-596; it was `watchlistLoading`, which also went false on a DEAD
      // listener, i.e. exactly when `watchlistItem` is null for a tracked title).
      // `status` is written unconditionally and no payload shape can protect it.
      // (BIN-593 made watchedAt safe on its own; status still isn't.)
      current: watchlistItem,
      providers: allProviderIds,
      subscriptionProviders: subscriptionProviderIdsForMovie,
      genreIds: movie.genres.map(g => g.id),
    // BIN-1025 follow-up (integration review, 2026-08-27): the toast waits for the write.
    //
    // It used to fire unconditionally beside a `void`ed call, which was true as long as the
    // write always landed — a full payload clears BIN-942's create floor. `writeTitle` now
    // REFUSES during an account deletion, so the unconditional toast became a confirmation
    // of a write Firestore never accepted: the BIN-895 false-confirmation class, made
    // reachable by that change and therefore this batch's to fix.
    //
    // A refusal now shows nothing rather than something false. Showing nothing is its own
    // shortcoming and is BIN-1038's question, together with every other caller that is
    // silent here — but silence and a lie are not the same defect.
    })).then(() => {
      toast(`Bevakar släppet av ${displayTitle}`);
    }).catch((err: unknown) => {
      // Only the refusal is swallowed, and only because it is already reported: the throw
      // site in `writeTitle` sends it to Sentry under `writeTitle-deletionRefused`, so a
      // second unhandled rejection here adds noise and no information. Anything else is a
      // real failure and keeps behaving exactly as it did before this handler chained —
      // rethrown, unhandled, visible.
      if (!isDeletionInProgressError(err)) throw err;
    });
  };

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
              <img src={poster} alt={displayTitle} loading="eager" fetchPriority="high" decoding="async" width={342} height={513} />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--placeholder-fill)',
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
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)', letterSpacing: 0.04 }}>
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
          {/* BIN-688 asked the SAME "does this text carry the page?" question the
              meta description asks, so the two halves cannot describe one film two
              ways. BIN-735 fixed what that cost: the 60-char line is a SNIPPET-
              quality measure, and using it to decide whether the film's own words
              appear AT ALL threw away genuine short synopses ("En dokumentär om
              Greta Thunberg.") in a module whose entire job is ADDING text to thin
              pages. So a real-but-thin overview is now shown AND followed by the
              generated sentence — the page loses nothing and still gains the extra
              prose. The meta description keeps the 60-char rule untouched, and the
              body still contains every word the snippet uses. */}
          {overviewText && <p className="syn">{overviewText}</p>}
          {needsContentFloorParagraph && <p className="syn">{contentFloor?.paragraph}</p>}

          {/* BIN-193: cinema→streaming countdown. ClientOnly — depends on
              library state (inLibrary) and isn't core SEO content. */}
          {cinemaInfo && (
            <ClientOnly>
              {/* Gated on the watchlist having SETTLED, not just on `watchlistItem`.
                  While it's still loading, getItem returns undefined for a film the
                  user may well have marked 'sedd' — and Bevaka hard-sets
                  status: 'vill_se', which would demote a TERMINAL film status.
                  (BIN-593 stopped that write from erasing watchedAt as well, but
                  the demotion alone still justifies the gate.) Hiding the CTA for
                  that moment is the only thing that makes the click safe; the
                  payload can't express "don't touch status". */}
              {/* BIN-596: `libraryKnown`, not `!watchlistLoading`. The comment
                  above always said "gated on the watchlist having SETTLED" —
                  `loading` does not mean that, it also goes false when the
                  listener dies, which is precisely when `watchlistItem` is null
                  for a film the user has already marked 'sedd'.

                  BIN-731 closed the hole that gate left: a signed-out visitor has
                  no listener, so `libraryKnown` is false for them FOREVER — the
                  whole "På bio nu · Hemma att hyra …" row used to disappear, not
                  just its CTA. `signedOut` is decided FIRST and separately, above
                  the library gate, for the reason useSignedOutRedirect spells out:
                  they will never have a library this session, so a library gate is
                  false forever for them and ordering it first is how the tap goes
                  dead. Their "Bevaka släpp" is a destination (/login, and back
                  here), never a write — which is what StatusButton and
                  QuickAddButton already do (BIN-714/645), so the same button no
                  longer behaves two ways in the same app. A signed-IN visitor
                  whose listener died still gets no row: theirs is a broken
                  library, and /login is not the answer to it. */}
              {(signedOut || libraryKnown) && (
                <CinemaCountdownStrip
                  info={cinemaInfo}
                  inLibrary={!!watchlistItem}
                  onBevaka={signedOut ? goToLogin : handleBevaka}
                />
              )}
            </ClientOnly>
          )}

          <div className="stats">
            <span><span className="k">år</span><strong>{year}</strong></span>
            {movie.runtime ? (
              <span><span className="k">längd</span><strong>{movie.runtime} min</strong></span>
            ) : null}
            <CommunityRating mediaType="movie" tmdbId={movie.id} />
          </div>
          <RatingsRow ratings={ratings} imdbId={movie.imdb_id ?? ''} tmdb={movie.vote_average} />

          <ClientOnly>
            <FriendsWhoSaw mediaType="movie" tmdbId={movie.id} />
          </ClientOnly>

          <ClientOnly>
            <div className="actions-row">
              <StatusButton
                tmdbId={movie.id}
                mediaType="movie"
                title={displayTitle}
                posterPath={movie.poster_path}
                releaseYear={parseInt(year, 10) || null}
                providers={allProviderIds}
                subscriptionProviders={subscriptionProviderIdsForMovie}
                genreIds={movie.genres.map(g => g.id)}
              />
              <div>
                {watchlistItem && (
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: 0.12, textTransform: 'uppercase', marginBottom: 3 }}>
                    Ditt betyg
                  </div>
                )}
                <RatingStars
                  rating={watchlistItem?.rating ?? null}
                  onChange={r => watchlistItem && updateRating('movie', movie.id, r)}
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
            {watchlistItem?.status === 'sedd' && (
              <WatchedDateEditor
                watchedAt={watchlistItem.watchedAt ?? null}
                onChange={d => updateWatchedAt('movie', movie.id, d)}
              />
            )}
          </ClientOnly>

          {mounted && (
            <CheapestPathVerdict
              subscriptionProviderIds={subForVerdict.map(p => canonicalProviderId(p.provider_id))}
              ownedProviderIds={myProviderIds}
              offers={offers}
              libraryAvailable={onCineasterna}
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

          {onCineasterna && (
            <div style={{ marginTop: 8 }}>
              <a
                href="https://www.cineasterna.com/sv/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm bg-bg-2 text-ink-2 px-2 py-1 text-[12px]"
              >
                Finns på Cineasterna ({user?.hemkommun ? `via biblioteket i ${user.hemkommun}` : 'via ditt bibliotek'})
                {cineRental && <span className="text-ink-3">· hyr {cineRental.amount} {cineRental.currency}</span>}
              </a>
            </div>
          )}

          {showRentBuy && hasRentBuy && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-3)' }}>
              {onSubscription.length > 0 && (
                <div className="rounded-sm bg-acc-soft text-acc-deep px-2 py-1 text-[12px]" style={{ marginBottom: 8 }}>
                  {subsYouOwn.length > 0
                    ? `Du abonnerar redan på ${subsYouOwn.map(p => p.provider_name).join(', ')} — du behöver inte hyra.`
                    : `Finns även med abonnemang på ${onSubscription.map(p => p.provider_name).join(', ')} — billigare än att hyra om du ser mer därifrån.`}
                </div>
              )}
              {rent.length > 0 && (
                <div>
                  <span style={{ letterSpacing: 0.12, textTransform: 'uppercase', marginRight: 6 }}>Hyr:</span>
                  {rent.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" offer={offerForProvider(offers, canonicalProviderId(p.provider_id))} nowMs={now} />)}
                </div>
              )}
              {/* BIN-354: rent price-history stat row (option C). Lazy — only
                  fetches priceHistory/{id} when this disclosure is expanded. */}
              <PriceHistoryChart tmdbId={movie.id} mediaType="movie" nowMs={now} />
              {buy.length > 0 && (
                <div>
                  <span style={{ letterSpacing: 0.12, textTransform: 'uppercase', marginRight: 6 }}>Köp:</span>
                  {buy.map(p => <ProviderTag key={p.provider_id} provider={p} size="md" offer={offerForProvider(offers, canonicalProviderId(p.provider_id))} nowMs={now} />)}
                </div>
              )}
            </div>
          )}

          {(subscription.length > 0 || hasRentBuy) && (
            <div style={{ marginTop: 8 }}>
              <JustWatchCredit />{' · '}<span className="text-ink-3 text-[11px]">Tillgänglighet via Movie of the Night</span>
            </div>
          )}
        </div>
      </div>

      {/* Trailer — raw 16:9 (preview surface). Döljs helt när embed saknas/failar (M1). */}
      <TrailerSection video={trailer} />

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

      {/* Notes + Reviews — auth-beroende, klient-only för att inte skapa
          hydration mismatch och inte exponeras för Googlebot (PII-risk) */}
      <ClientOnly>
        {watchlistItem && (
          <section className="detail-section">
            <div className="head">
              <h2>Din anteckning</h2>
            </div>
            <NotesBlock notes={watchlistItem.notes} onChange={notes => updateNotes('movie', movie.id, notes)} />
            <TagEditor
              tags={watchlistItem.tags ?? []}
              onChange={t => updateTags('movie', movie.id, t)}
              suggestions={tagsInLibrary(items)}
            />
          </section>
        )}
        <section className="detail-section">
          <ReviewList tmdbId={movie.id} mediaType="movie" title={displayTitle} posterPath={movie.poster_path} />
        </section>
      </ClientOnly>

      {/* BIN-422: crawlbar franchise-länk i statisk HTML (utanför ClientOnly) —
          intern länkning till /billigaste som Google följer. Visas för kända
          franchises oavsett collection-fetchens tillstånd. */}
      {franchise && (
        <section className="detail-section" style={{ borderTop: '1px solid var(--rule)', paddingTop: 28 }}>
          <Link
            href={`/billigaste/${franchise.slug}/`}
            className="text-sm text-acc-deep hover:underline inline-block"
          >
            Billigaste sättet att se hela {franchise.name} →
          </Link>
        </section>
      )}

      {/* Franchise/samling (BIN-94) — din progress genom serien, ovanför generiska
          "liknande filmer". Bara när filmen hör till en TMDB-samling. */}
      {movie.belongs_to_collection && (
        <ClientOnly>
          <CollectionSection collectionId={movie.belongs_to_collection.id} currentMovieId={movie.id} />
        </ClientOnly>
      )}

      {/* Kompanjonserie (+ ev. systerfilmer) — filmen bygger på en TV-serie (curated,
          cross-type). Kan samexistera med TMDB-samlingen ovan: samling = film→film,
          kompanjon = film→serie. Renderar inget för omappade filmer. */}
      <CompanionSection anchorMediaType="movie" anchorId={movie.id} />

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
            {mappedRecs.map(rec => (
              <RecCard key={`${rec.media_type}-${rec.id}`} item={rec} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
