'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import AuthGuard from '@/components/AuthGuard';
import { useFollowing } from '@/hooks/useFollow';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { toDate } from '@/lib/firebase/utils';
import { posterUrl } from '@/lib/tmdb/client';

export default function FeedPage() {
  return <AuthGuard><FeedContent /></AuthGuard>;
}

function FeedContent() {
  const { followingUids } = useFollowing();
  const { user } = useAuth();

  const { data: feedItems, isLoading } = useQuery({
    queryKey: ['feed', followingUids],
    queryFn: async () => {
      if (followingUids.length === 0) return [];
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const results = await Promise.all(
        followingUids.slice(0, 30).map(async uid => {
          const [profileSnap, watchlistSnap] = await Promise.all([
            getDoc(doc(db, 'users', uid)),
            getDocs(query(
              collection(db, 'users', uid, 'watchlist'),
              where('updatedAt', '>=', twoWeeksAgo),
              orderBy('updatedAt', 'desc'),
              limit(5),
            )),
          ]);
          const profile = profileSnap.data();
          const displayName = profile?.displayName ?? 'Okänd';
          const username = profile?.username ?? null;
          return watchlistSnap.docs.map(d => {
            const data = d.data();
            return {
              uid,
              displayName,
              username,
              title: data.title as string,
              tmdbId: data.tmdbId as number,
              mediaType: data.mediaType as string,
              status: data.status as string,
              posterPath: (data.posterPath as string) ?? null,
              updatedAt: toDate(data.updatedAt),
            };
          });
        })
      );
      return results.flat().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    },
    enabled: followingUids.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  return (
    <div>
      <h1 className="text-[18px] font-bold text-text-primary mb-3">Flöde</h1>

      {isLoading && <div className="text-sm text-text-muted py-4">Laddar...</div>}

      {!isLoading && followingUids.length === 0 && (
        <div className="bg-surface border border-border-main rounded-sm px-4 py-4">
          <p className="text-xs text-text-secondary mb-3 leading-relaxed">
            Se vad dina vänner tittar på, betygsätter och lägger till. Följ andra användare för att se deras aktivitet här.
          </p>
          <div className="border border-dashed border-border-main rounded-sm p-[10px] mb-3">
            <div className="text-xxs uppercase tracking-[0.5px] text-text-muted mb-[6px]">Så här ser det ut</div>
            <div className="flex gap-2 items-center py-[3px] opacity-50">
              <div className="w-[20px] h-[20px] rounded-full bg-accent shrink-0" />
              <div>
                <div className="text-xxs"><b>Anna</b> <span className="text-text-muted">betygsatte</span> <b>The Bear</b> <span className="text-accent">★★★★★</span></div>
                <div className="text-xxs text-text-muted">2 timmar sedan</div>
              </div>
            </div>
            <div className="flex gap-2 items-center py-[3px] opacity-50">
              <div className="w-[20px] h-[20px] rounded-full bg-[#6a7d5e] shrink-0" />
              <div>
                <div className="text-xxs"><b>Erik</b> <span className="text-text-muted">började följa</span> <b>Severance</b></div>
                <div className="text-xxs text-text-muted">5 timmar sedan</div>
              </div>
            </div>
          </div>
          <div className="text-center">
            <Link href="/search" className="inline-block px-3 py-[5px] bg-accent text-white border-none rounded-sm text-xs font-semibold no-underline">
              Sök användare att följa
            </Link>
            {user?.username && (
              <div className="text-xxs text-text-muted mt-[4px]">
                eller dela din profillänk: <span className="text-text-secondary">binge.nu/u/{user.username}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {feedItems && feedItems.length === 0 && followingUids.length > 0 && (
        <div className="bg-surface border border-border-main rounded-sm px-4 py-6 text-center">
          <p className="text-sm text-text-muted">Ingen aktivitet de senaste 2 veckorna.</p>
        </div>
      )}

      <div className="space-y-[6px]">
        {feedItems?.map((item, i) => {
          const href = `/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}/`;
          const poster = posterUrl(item.posterPath, 'w92');
          const statusLabel = item.status === 'sedd' ? 'markerade som sedd' : item.status === 'följer' ? 'började följa' : item.status === 'vill_se' ? 'vill se' : 'uppdaterade';
          return (
            <div key={`${item.uid}-${item.tmdbId}-${i}`} className="bg-surface border border-border-main rounded-sm px-3 py-2 flex gap-2">
              {poster && <img src={poster} alt="" className="w-[30px] h-[45px] rounded-sm object-cover shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-xs">
                  {item.username ? (
                    <Link href={`/user/${item.username}/`} className="font-semibold text-text-primary no-underline hover:text-accent">{item.displayName}</Link>
                  ) : (
                    <span className="font-semibold">{item.displayName}</span>
                  )}
                  <span className="text-text-muted"> {statusLabel} </span>
                  <Link href={href} className="font-semibold text-text-primary no-underline hover:text-accent">{item.title}</Link>
                </div>
                <div className="text-xxs text-text-muted mt-[1px]">
                  {item.updatedAt.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
