'use client';

import Link from 'next/link';
import { usePublicProfile, usePublicWatchlist } from '@/hooks/usePublicProfile';
import { useAuth } from '@/hooks/useAuth';
import { useFollowerCount, useFollowingCount } from '@/hooks/useFollow';
import { useTasteMatch } from '@/hooks/useTasteVector';
import FollowButton from '@/components/social/FollowButton';
import FriendButton from '@/components/social/FriendButton';
import ProfileStatsPanel from '@/components/social/ProfileStatsPanel';
import StatCard from '@/components/ui/StatCard';
import { posterUrl } from '@/lib/tmdb/client';
import { toneForId } from '@/lib/duotone';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { NotFound } from '@/components/ui/NotFound';

export default function UserProfilePageClient({ username }: { username: string }) {
  const { data, isLoading } = usePublicProfile(username);
  const { uid: myUid } = useAuth();
  // Följar-räkningen (getCountFromServer på följare/följer-subkollektionerna)
  // är per firestore.rules bara läsbar för publika profiler eller ägaren själv
  // (isOwner || isPublic — vänner ingår INTE). Att fråga på en privat profil
  // ger permission-denied i konsolen och ändå ingen siffra. Skicka därför bara
  // in uid när profilen faktiskt är publik eller min egen.
  const profileUid = data && 'uid' in data ? data.uid : null;
  // BIN-505: följar-count-queryn (getCountFromServer på followers/following) är
  // per rules bara läsbar för PUBLIKA profiler eller ägaren — INTE vänner. Så vi
  // skickar bara in uid när projektionen säger publik (card.isPublic) eller det
  // är min egen profil; annars skulle en vän-bara-profilvisning fyra två nekade
  // count-queries → Sentry/Plausible-brus (och räkningen faller ändå till 0).
  const countableUid = data && 'card' in data && (data.card.isPublic || profileUid === myUid)
    ? profileUid : null;
  // Watchlistan läses bara när profilen faktiskt är läsbar för mig. Att
  // usePublicProfile returnerar { card, uid } (inte { isPrivate }) betyder att
  // rules redan släppt in mig — dvs profilen är publik, eller vän-synlig och jag
  // är vän, eller min egen. Just då går watchlist-queries igenom. På privata/
  // icke-vän-profiler skickar vi null så inga onödiga permission-denied loggas
  // (hooken sväljer dessutom kvarvarande fel internt).
  const watchlistUid = data && 'card' in data ? data.uid : null;
  const watchlistQuery = usePublicWatchlist(watchlistUid);
  const followerQuery = useFollowerCount(countableUid);
  const followingQuery = useFollowingCount(countableUid);
  const watchlist = watchlistQuery.data;
  const followerCount = followerQuery.data;
  const followingCount = followingQuery.data;
  const taste = useTasteMatch(data?.uid ?? null);

  const metaTitle = data && 'card' in data ? data.card.displayName : `@${username}`;
  usePageMeta({ title: metaTitle });

  // P1: stat-korten och följar-raden beräknas från egna queries (watchlist,
  // follower/following-count) — gatea även på dem så profilen inte blinkar
  // "0 · 0 · 0 · —" innan datan landat. Queriesarna är enabled-gatade på uid,
  // så "laddar" = isPending medan fetch faktiskt pågår (inte idle/disabled).
  const queryLoading = (q: { isPending: boolean; fetchStatus: string }) =>
    q.isPending && q.fetchStatus !== 'idle';
  const statsLoading = queryLoading(watchlistQuery) || queryLoading(followerQuery) || queryLoading(followingQuery);

  if (isLoading || statsLoading) return <LoadingView variant="detail" label="Laddar profil…" />;
  if (!data) return <NotFound crumb="Profil" title="Användaren hittades inte." />;

  // Tre-state från usePublicProfile: null (ej användare), { isPrivate }
  // (finns men ej läsbar), { profile, uid } (full).
  if ('isPrivate' in data) {
    return <NotFound crumb={`@${username}`} title="Privat profil" body="Den här profilen är privat." />;
  }

  const { card, uid } = data;
  // BIN-505: ingen defensiv tier-check längre — firestore.rules gate:ar
  // publicProfiles-läsningen live mot källans visibility, så en läsbar card ÄR
  // synlighetsbeviset. Ägaren når alltid sin egen via isOwner-grenen.

  // "Följer" på publik profil = TV-shows i 'mina' (samlingen). Sedd = filmer
  // i 'sedd' (TV i 'mina' med sub-state avslutad räknas inte med här —
  // användaren ser sina serier under "Följer", inte separat).
  const following = (watchlist ?? []).filter(i => i.status === 'mina' && !i.dropped);
  const watched = (watchlist ?? []).filter(i => i.status === 'sedd');
  const rated = (watchlist ?? []).filter(i => i.rating !== null);
  const avgRating = rated.length > 0 ? rated.reduce((s, i) => s + (i.rating ?? 0), 0) / rated.length : 0;
  const recentlyWatched = watched.sort((a, b) => (b.watchedAt?.getTime() ?? 0) - (a.watchedAt?.getTime() ?? 0)).slice(0, 8);
  const isOwnProfile = uid === myUid;

  return (
    <div>
      <PageHeader
        crumb={`@${username}`}
        title={card.displayName}
        standfirst={card.bio || undefined}
        actions={
          <>
            {!isOwnProfile && <FollowButton targetUid={uid} />}
            {!isOwnProfile && <FriendButton targetUid={uid} />}
            {isOwnProfile && (
              <Link href="/settings" className="text-xs text-acc-deep no-underline">Redigera profil</Link>
            )}
            <span className="text-xs text-ink-3">{followerCount ?? 0} följare · {followingCount ?? 0} följer</span>
          </>
        }
      />

      <div className="grid grid-cols-4 gap-[10px] mb-4 mt-3">
        <StatCard label="Totalt" value={(watchlist ?? []).length} />
        <StatCard label="Följer" value={following.length} />
        <StatCard label="Sedd" value={watched.length} />
        <StatCard label="Medelbetyg" value={avgRating > 0 ? avgRating.toFixed(1) : '—'} />
      </div>

      <ProfileStatsPanel items={watchlist ?? []} />

      {!isOwnProfile && (
        <div className="bg-surface border border-rule rounded-sm px-3 py-2 mb-4">
          <div className="text-xxs uppercase tracking-[0.5px] text-ink-3 font-semibold mb-[2px]">
            Smak-match med dig
          </div>
          {taste.percent != null ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[22px] font-bold text-acc-deep leading-none">{taste.percent}%</span>
              <span className="text-xxs text-ink-3">
                baserat på {taste.mySampleSize} titlar från dig och {taste.theirSampleSize} från {card.displayName}
              </span>
            </div>
          ) : (
            <div className="text-xs text-ink-3">
              {taste.mySampleSize < 5
                ? 'Lägg till och betygsätt fler titlar för att se smak-match.'
                : `${card.displayName} har för få betygsatta titlar för att räkna ut matchning.`}
            </div>
          )}
        </div>
      )}

      {following.length > 0 && (
        <div className="bg-surface border border-rule rounded-sm mb-[14px]">
          <div className="px-3 py-[6px] border-b border-rule-2">
            <span className="text-sm font-bold text-ink-2">Följer just nu</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-[7px] px-3 py-2">
            {following.slice(0, 10).map(item => (
              <Link key={item.tmdbId} href={`/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}/`} className="no-underline text-ink">
                <div className={`poster duo-${toneForId(item.tmdbId)} mb-[3px]`}>
                  {posterUrl(item.posterPath, 'w342') && (
                    <img src={posterUrl(item.posterPath, 'w342')!} alt={item.title} loading="lazy" decoding="async" width={342} height={513} />
                  )}
                </div>
                <div className="text-xs font-semibold truncate">{item.title}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {recentlyWatched.length > 0 && (
        <div className="bg-surface border border-rule rounded-sm mb-[14px]">
          <div className="px-3 py-[6px] border-b border-rule-2">
            <span className="text-sm font-bold text-ink-2">Senast sedd</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-[7px] px-3 py-2">
            {recentlyWatched.map(item => (
              <Link key={item.tmdbId} href={`/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}/`} className="no-underline text-ink">
                <div className={`poster duo-${toneForId(item.tmdbId)} mb-[3px]`}>
                  {posterUrl(item.posterPath, 'w342') && (
                    <img src={posterUrl(item.posterPath, 'w342')!} alt={item.title} loading="lazy" decoding="async" width={342} height={513} />
                  )}
                </div>
                <div className="text-xs font-semibold truncate">{item.title}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

