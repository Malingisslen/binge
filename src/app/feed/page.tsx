'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Heart, MessageCircle, TrendingUp } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import QuickAddButton from '@/components/title/QuickAddButton';
import { LoadingView } from '@/components/ui/LoadingView';
import { useFollowing } from '@/hooks/useFollow';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { useAuth } from '@/hooks/useAuth';
import { fsdb } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { getPublicProfileCard } from '@/lib/firebase/publicProfile';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { computeFollowTrending, type TrendingTitle } from '@/lib/feedTrending';
import type { MediaType } from '@/types';

interface FeedWatchlistItem {
  kind: 'watchlist';
  uid: string;
  displayName: string;
  username: string | null;
  title: string;
  tmdbId: number;
  mediaType: string;
  status: string;
  posterPath: string | null;
  updatedAt: Date;
}

interface FeedReviewItem {
  kind: 'review';
  uid: string;
  displayName: string;
  username: string | null;
  reviewId: string;
  tmdbId: number;
  mediaType: string;
  title: string;
  text: string;
  spoiler: boolean;
  posterPath: string | null;
  updatedAt: Date;
}

type FeedItem = FeedWatchlistItem | FeedReviewItem;

export default function FeedPage() {
  return <AuthGuard><FeedContent /></AuthGuard>;
}

function FeedContent() {
  const { followingUids } = useFollowing();
  const { isBlocked } = useBlockedUsers();
  const { user } = useAuth();

  const { data: feedItems, isLoading } = useQuery({
    queryKey: ['feed', followingUids],
    queryFn: async (): Promise<FeedItem[]> => {
      if (followingUids.length === 0) return [];
      const { db, collection, getDocs, query, where, orderBy, limit } = await fsdb();
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const results = await Promise.all(
        followingUids.slice(0, 30).map(async uid => {
          const [card, watchlistSnap, reviewsSnap] = await Promise.all([
            getPublicProfileCard(uid),
            getDocs(query(
              collection(db, 'users', uid, 'watchlist'),
              where('updatedAt', '>=', twoWeeksAgo),
              orderBy('updatedAt', 'desc'),
              limit(5),
            )),
            // orderBy är inte kosmetiskt: utan det sorterar Firestore på
            // __name__ (recensioner skapas med addDoc → slumpade id:n), så
            // limit(10) plockade ett GODTYCKLIGT urval — en nyskriven
            // recension föll oftast utanför och 14-dagarsfiltret nedan slängde
            // resten. Samma form som useReviews.ts; index uid+createdAt finns
            // redan i firestore.indexes.json. (BIN-600)
            getDocs(query(
              collection(db, 'reviews'),
              where('uid', '==', uid),
              orderBy('createdAt', 'desc'),
              limit(10),
            )),
          ]);
          const displayName = card?.displayName ?? 'Okänd';
          const username = card?.username ?? null;

          const watchlistItems: FeedItem[] = watchlistSnap.docs.map(d => {
            const data = d.data();
            return {
              kind: 'watchlist',
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

          const reviewItems: FeedReviewItem[] = [];
          for (const d of reviewsSnap.docs) {
            const data = d.data();
            const createdAt = toDate(data.createdAt);
            if (createdAt < twoWeeksAgo) continue;
            reviewItems.push({
              kind: 'review',
              uid,
              displayName,
              username,
              reviewId: d.id,
              tmdbId: data.tmdbId as number,
              mediaType: data.mediaType as string,
              title: (data.title as string) ?? 'Okänd titel',
              text: data.text as string,
              spoiler: (data.spoiler as boolean) ?? false,
              posterPath: null,
              updatedAt: createdAt,
            });
          }

          return [...watchlistItems, ...reviewItems];
        })
      );
      return results.flat().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    },
    enabled: followingUids.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  // BIN-101: aggregate "trendar bland personer du följer" from the same feed
  // data (no extra reads). Blocked users filtered out first so they don't count.
  const visibleItems = useMemo(
    () => (feedItems ?? []).filter(item => !isBlocked(item.uid)),
    [feedItems, isBlocked],
  );
  const trending = useMemo(() => computeFollowTrending(visibleItems), [visibleItems]);

  return (
    <>
      <header>
        <div className="crumb">Vänner · Flöde</div>
        <h1 className="page-h1">Flöde</h1>
        <p className="stand">
          Senaste från dina vänner — recensioner, betyg och uppdateringar.
        </p>
      </header>
      <div style={{ marginTop: 28 }}>

      {isLoading && <LoadingView label="Laddar…" />}

      {!isLoading && trending.length > 0 && <TrendingRow titles={trending} />}

      {!isLoading && followingUids.length === 0 && (
        <div className="bg-surface border border-rule rounded-sm px-4 py-4">
          <p className="text-xs text-ink-2 mb-3 leading-relaxed">
            Se vad dina vänner tittar på, betygsätter och lägger till. Följ andra användare för att se deras aktivitet här.
          </p>
          <div className="border border-dashed border-rule rounded-sm p-[10px] mb-3">
            <div className="text-xxs uppercase tracking-[0.5px] text-ink-3 mb-[6px]">Så här ser det ut</div>
            <div className="flex gap-2 items-center py-[3px] opacity-50">
              <div className="w-[20px] h-[20px] rounded-full bg-acc-deep shrink-0" />
              <div>
                <div className="text-xxs"><b>Anna</b> <span className="text-ink-3">betygsatte</span> <b>The Bear</b> <span className="text-acc-deep">★★★★★</span></div>
                <div className="text-xxs text-ink-3">2 timmar sedan</div>
              </div>
            </div>
            <div className="flex gap-2 items-center py-[3px] opacity-50">
              <div className="w-[20px] h-[20px] rounded-full bg-duo-moss shrink-0" />
              <div>
                <div className="text-xxs"><b>Erik</b> <span className="text-ink-3">började följa</span> <b>Severance</b></div>
                <div className="text-xxs text-ink-3">5 timmar sedan</div>
              </div>
            </div>
          </div>
          <div className="text-center">
            <Link href="/search" className="inline-block px-3 py-[5px] bg-acc-deep text-white border-none rounded-sm text-xs font-semibold no-underline">
              Sök användare att följa
            </Link>
            {user?.username && (
              <div className="text-xxs text-ink-3 mt-[4px]">
                eller dela din profillänk: <span className="text-ink-2">binge.nu/u/{user.username}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {feedItems && feedItems.length === 0 && followingUids.length > 0 && (
        <div className="bg-surface border border-rule rounded-sm px-4 py-6 text-center">
          <p className="text-sm text-ink-3">Ingen aktivitet de senaste 2 veckorna.</p>
        </div>
      )}

      <div className="space-y-[6px]">
        {visibleItems.map((item, i) => {
          const key = item.kind === 'review' ? `r-${item.reviewId}` : `w-${item.uid}-${item.tmdbId}-${i}`;
          if (item.kind === 'review') return <FeedReviewCard key={key} item={item} />;
          return <FeedWatchlistCard key={key} item={item} />;
        })}
      </div>
      </div>
    </>
  );
}

// BIN-101 — social-proof discovery row: titles ≥2 followed users recently added.
function TrendingRow({ titles }: { titles: TrendingTitle[] }) {
  const followerLabel = (t: TrendingTitle) =>
    `${t.followerCount} du följer har den`;
  return (
    <section className="mb-4">
      <h2 className="text-xxs uppercase tracking-[0.5px] text-ink-3 font-semibold mb-2 flex items-center gap-1">
        <TrendingUp size={12} aria-hidden /> Trendar bland personer du följer
      </h2>
      <div className="flex gap-[8px] overflow-x-auto pb-1">
        {titles.map(t => {
          const poster = posterUrl(t.posterPath, 'w92');
          return (
            <Link
              key={t.tmdbId}
              href={titleHref(t.mediaType === 'movie' ? 'movie' : 'tv', t.tmdbId)}
              className="shrink-0 w-[120px] bg-surface border border-rule rounded-md p-[8px] no-underline hover:border-rule-2 transition-colors"
            >
              <div className="flex gap-[8px]">
                {poster && (
                  <img src={poster} alt="" className="w-[34px] h-[51px] rounded-sm object-cover shrink-0" loading="lazy" decoding="async" width={34} height={51} />
                )}
                <div className="min-w-0">
                  <div className="text-xxs font-semibold text-ink leading-snug line-clamp-3">{t.title}</div>
                </div>
              </div>
              <div className="text-xxs text-acc-deep font-semibold mt-[6px]">{followerLabel(t)}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function FeedWatchlistCard({ item }: { item: FeedWatchlistItem }) {
  const href = `/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}/`;
  const poster = posterUrl(item.posterPath, 'w92');
  // 'mina' (TV) → "följer" (socialt språk); film 'sedd' → "markerade som
  // sedd"; vill_se (film) → "vill se".
  const statusLabel =
    item.status === 'mina' ? 'följer'
    : item.status === 'sedd' ? 'markerade som sedd'
    : item.status === 'vill_se' ? 'vill se'
    : 'uppdaterade';
  return (
    <div className="bg-surface border border-rule rounded-sm px-3 py-2 flex gap-2 items-center">
      {poster && <img src={poster} alt="" className="w-[30px] h-[45px] rounded-sm object-cover shrink-0" loading="lazy" decoding="async" width={30} height={45} />}
      <div className="flex-1 min-w-0">
        <div className="text-xs">
          {item.username ? (
            <Link href={`/user/${item.username}/`} className="font-semibold text-ink no-underline hover:text-acc-deep">{item.displayName}</Link>
          ) : (
            <span className="font-semibold">{item.displayName}</span>
          )}
          <span className="text-ink-3"> {statusLabel} </span>
          <Link href={href} className="font-semibold text-ink no-underline hover:text-acc-deep">{item.title}</Link>
        </div>
        <div className="text-xxs text-ink-3 mt-[1px]">
          {item.updatedAt.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}
        </div>
      </div>
      <div className="shrink-0">
        <QuickAddButton
          tmdbId={item.tmdbId}
          mediaType={item.mediaType as MediaType}
          title={item.title}
          posterPath={item.posterPath}
          releaseYear={null}
        />
      </div>
    </div>
  );
}

function FeedReviewCard({ item }: { item: FeedReviewItem }) {
  const href = `/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}/#review-${item.reviewId}`;
  const preview = item.text.length > 160 ? item.text.slice(0, 160) + '…' : item.text;
  return (
    <div className="bg-surface border border-rule rounded-sm px-3 py-2">
      <div className="text-xs mb-1">
        {item.username ? (
          <Link href={`/user/${item.username}/`} className="font-semibold text-ink no-underline hover:text-acc-deep">{item.displayName}</Link>
        ) : (
          <span className="font-semibold">{item.displayName}</span>
        )}
        <span className="text-ink-3"> recenserade </span>
        <Link href={href} className="font-semibold text-ink no-underline hover:text-acc-deep">{item.title}</Link>
      </div>
      {item.spoiler ? (
        <div className="text-xxs text-ink-3 italic">Spoiler — öppna recensionen för att läsa.</div>
      ) : (
        <p className="text-xs text-ink-2 leading-relaxed m-0 mb-[4px]">{preview}</p>
      )}
      <div className="flex items-center gap-3 text-xxs text-ink-3 pt-[4px] border-t border-rule-2">
        <span>{item.updatedAt.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}</span>
        <Link href={href} className="inline-flex items-center gap-[3px] text-ink-3 hover:text-acc-deep no-underline">
          <Heart size={10} /> <MessageCircle size={10} /> Läs och svara
        </Link>
      </div>
    </div>
  );
}
