'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Film, Tv } from 'lucide-react';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { PosterProviderDots } from '@/components/watchlist/WatchlistProviderDisplay';
import { LibrarySubnav } from '@/components/WatchlistPage';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { toneForId } from '@/lib/duotone';
import type { WatchlistItem } from '@/types';

type MediaFilter = 'all' | 'tv' | 'movie';

// Väljaren — "vad ska du se ikväll?". Visar filmer i 'vill_se' + följda
// serier utan progress (läget ej påbörjad). Jobbet är att VÄLJA, inte
// förvalta: ingen statushantering, inga bulk-actions — varje kort är en
// länk till titelsidan där man börjar titta. Förvaltning bor i /my/series
// (serier) och /my/films (filmer). Att samma serie även syns under
// Följer → Ej påbörjade är avsiktligt: olika vyer, olika jobb.
export default function VillSePickerPage() {
  const { items, loading } = useWatchlist();
  const { user } = useAuth();
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');

  const myProviders = useMemo(
    () => new Set(user?.myProviders ?? []),
    [user?.myProviders]
  );

  const picks = useMemo(() => {
    const base = items.filter(i =>
      i.mediaType === 'movie'
        ? i.status === 'vill_se'
        : i.status === 'mina' && !i.dropped && i.lastWatchedSeason == null
    );
    const filtered = mediaFilter === 'all' ? base : base.filter(i => i.mediaType === mediaFilter);
    // Valögonblickets sortering: det du kan se direkt (finns på dina
    // tjänster) överst, därefter senast tillagd.
    const onMine = (i: WatchlistItem) => i.providers.some(p => myProviders.has(p));
    return [...filtered].sort((a, b) => {
      const am = onMine(a) ? 0 : 1;
      const bm = onMine(b) ? 0 : 1;
      if (am !== bm) return am - bm;
      return b.addedAt.getTime() - a.addedAt.getTime();
    });
  }, [items, mediaFilter, myProviders]);

  const header = (
    <PageHeader
      crumb="Bibliotek · vill se"
      title="Vill se"
      standfirst="Vad ska du se ikväll? Filmer du vill se och serier du följer men inte börjat."
    />
  );

  if (loading) {
    return (
      <>
        {header}
        <LibrarySubnav status="vill_se" />
        <LoadingView variant="grid" label="Laddar biblioteket…" />
      </>
    );
  }

  return (
    <>
      {header}
      <LibrarySubnav status="vill_se" />

      <div style={{ display: 'flex', gap: 6, marginTop: 22 }}>
        {(['all', 'tv', 'movie'] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setMediaFilter(f)}
            className={`chip${mediaFilter === f ? ' is-on' : ''}`}
          >
            {f === 'all' ? 'Alla' : f === 'tv' ? 'Serier' : 'Film'}
          </button>
        ))}
      </div>

      {picks.length === 0 ? (
        <div style={{ marginTop: 18 }}>
          <EmptyState
            title="Inget att välja på."
            body="Här samlas filmer du vill se och serier du följer men inte börjat. Hitta något via Rekommendationer."
            action={
              <Link href="/recommendations/" className="chip no-underline">
                Till rekommendationer
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div
            className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[10px] md:gap-[7px]"
            style={{ marginTop: 18 }}
          >
            {picks.map(item => {
              const poster = posterUrl(item.posterPath, 'w342');
              const href = titleHref(item.mediaType, item.tmdbId);
              const Icon = item.mediaType === 'tv' ? Tv : Film;
              return (
                <Link key={`${item.mediaType}-${item.tmdbId}`} href={href} className="no-underline text-text-primary">
                  <div className={`poster duo-${toneForId(item.tmdbId)} mb-[3px]`}>
                    {poster ? (
                      <img src={poster} alt={item.title} loading="lazy" decoding="async" width={342} height={513} />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center px-2 gap-1">
                        <Icon size={20} className="text-ink-3 opacity-40" />
                        <span className="text-[10px] text-ink-3 text-center line-clamp-3 leading-tight">{item.title}</span>
                      </div>
                    )}
                    <PosterProviderDots providers={item.providers} myProviders={user?.myProviders ?? []} />
                  </div>
                  <div className="text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
                    {item.title}
                  </div>
                  <div className="text-xxs text-text-muted">
                    {item.mediaType === 'tv' ? 'Serie' : 'Film'}{item.releaseYear ? ` · ${item.releaseYear}` : ''}
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="mt-2 text-xxs text-text-muted">
            Prickar på postern = streamingtjänst (färg per tjänst, hovra för namn). Fylld prick = tjänst du har. Titlar på dina tjänster visas först.
          </p>
          <div style={{ marginTop: 16 }}>
            <JustWatchCredit />
          </div>
        </>
      )}
    </>
  );
}
