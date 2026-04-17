'use client';

import Link from 'next/link';
import { usePublicProfile, usePublicWatchlist } from '@/hooks/usePublicProfile';
import { useAuth } from '@/hooks/useAuth';
import { useFollowerCount, useFollowingCount } from '@/hooks/useFollow';
import { useTasteMatch } from '@/hooks/useTasteVector';
import FollowButton from '@/components/social/FollowButton';
import StatCard from '@/components/ui/StatCard';
import { posterUrl } from '@/lib/tmdb/client';

export default function UserProfilePageClient({ username }: { username: string }) {
  const { data, isLoading } = usePublicProfile(username);
  const { data: watchlist } = usePublicWatchlist(data?.uid ?? null);
  const { uid: myUid } = useAuth();
  const { data: followerCount } = useFollowerCount(data?.uid ?? null);
  const { data: followingCount } = useFollowingCount(data?.uid ?? null);
  const taste = useTasteMatch(data?.uid ?? null);

  if (isLoading) return <div className="text-sm text-text-muted py-4">Laddar...</div>;
  if (!data) return <div className="text-sm text-text-muted py-4">Användaren hittades inte.</div>;

  const { profile, uid } = data;

  if (!profile.isPublic && uid !== myUid) {
    return (
      <div className="text-center py-8">
        <div className="text-[18px] font-bold text-text-primary mb-1">@{username}</div>
        <p className="text-sm text-text-muted">Den här profilen är privat.</p>
      </div>
    );
  }

  const following = (watchlist ?? []).filter(i => i.status === 'följer' && !i.dropped);
  const watched = (watchlist ?? []).filter(i => i.status === 'sedd');
  const rated = (watchlist ?? []).filter(i => i.rating !== null);
  const avgRating = rated.length > 0 ? rated.reduce((s, i) => s + (i.rating ?? 0), 0) / rated.length : 0;
  const recentlyWatched = watched.sort((a, b) => (b.watchedAt?.getTime() ?? 0) - (a.watchedAt?.getTime() ?? 0)).slice(0, 8);
  const isOwnProfile = uid === myUid;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[18px] font-bold text-text-primary">{profile.displayName}</h1>
        <div className="text-xs text-text-muted">@{username}</div>
        {profile.bio && <p className="text-base text-text-secondary mt-1">{profile.bio}</p>}
        <div className="flex items-center gap-2 mt-1">
          {!isOwnProfile && <FollowButton targetUid={uid} />}
          {isOwnProfile && (
            <Link href="/settings" className="text-xxs text-accent no-underline">Redigera profil</Link>
          )}
          <span className="text-xxs text-text-muted">{followerCount ?? 0} följare · {followingCount ?? 0} följer</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-[10px] mb-4">
        <StatCard label="Totalt" value={(watchlist ?? []).length} />
        <StatCard label="Följer" value={following.length} />
        <StatCard label="Sedd" value={watched.length} />
        <StatCard label="Medelbetyg" value={avgRating > 0 ? avgRating.toFixed(1) : '—'} />
      </div>

      {!isOwnProfile && (
        <div className="bg-surface border border-border-main rounded-sm px-3 py-2 mb-4">
          <div className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-[2px]">
            Smak-match med dig
          </div>
          {taste.percent != null ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[22px] font-bold text-accent leading-none">{taste.percent}%</span>
              <span className="text-xxs text-text-muted">
                baserat på {taste.mySampleSize} titlar från dig och {taste.theirSampleSize} från {profile.displayName}
              </span>
            </div>
          ) : (
            <div className="text-xs text-text-muted">
              {taste.mySampleSize < 5
                ? 'Lägg till och betygsätt fler titlar för att se smak-match.'
                : `${profile.displayName} har för få betygsatta titlar för att räkna ut matchning.`}
            </div>
          )}
        </div>
      )}

      {following.length > 0 && (
        <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
          <div className="px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Följer just nu</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-[7px] px-3 py-2">
            {following.slice(0, 10).map(item => (
              <Link key={item.tmdbId} href={`/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}/`} className="no-underline text-text-primary">
                <div className="aspect-[2/3] bg-[#ddd8d0] rounded-sm mb-[3px] overflow-hidden">
                  {posterUrl(item.posterPath, 'w342') && (
                    <img src={posterUrl(item.posterPath, 'w342')!} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                  )}
                </div>
                <div className="text-xs font-semibold truncate">{item.title}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {recentlyWatched.length > 0 && (
        <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
          <div className="px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Senast sedd</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-[7px] px-3 py-2">
            {recentlyWatched.map(item => (
              <Link key={item.tmdbId} href={`/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}/`} className="no-underline text-text-primary">
                <div className="aspect-[2/3] bg-[#ddd8d0] rounded-sm mb-[3px] overflow-hidden">
                  {posterUrl(item.posterPath, 'w342') && (
                    <img src={posterUrl(item.posterPath, 'w342')!} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
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

