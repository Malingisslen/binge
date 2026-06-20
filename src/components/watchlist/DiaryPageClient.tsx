'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { PageHeader } from '@/components/layout/PageHeader';
import { LibrarySubnav } from '@/components/WatchlistPage';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import RatingStars from '@/components/title/RatingStars';
import { buildFilmDiary, diaryFilmCount } from '@/lib/diary';

// BIN-103 — film watch-diary. Reverse-chron list of sedd films by watchedAt,
// grouped by month. Pure client read over the already-loaded watchlist (no
// extra Firestore/TMDB) — the payoff of editable watch dates (BIN-91).
export default function DiaryPageClient() {
  const { items, loading } = useWatchlist();
  const months = useMemo(() => buildFilmDiary(items), [items]);
  const total = diaryFilmCount(months);

  return (
    <div>
      <PageHeader
        crumb="Bibliotek"
        title="Dagbok"
        standfirst={total > 0
          ? `${total} ${total === 1 ? 'film' : 'filmer'} du sett — senast först.`
          : 'Din filmhistorik — när du såg vad.'}
      />
      <LibrarySubnav activeKey="diary" />

      {loading ? (
        <LoadingView variant="grid" />
      ) : total === 0 ? (
        <div className="mt-[18px]">
          <EmptyState
            icon={<BookOpen size={28} />}
            title="Inga daterade filmer än"
            body="När du markerar en film som sedd sparas datumet här. Du kan backdatera datumet när du bockar av en film, så även gamla filmer hamnar rätt i tidslinjen."
            action={<Link href="/my/films/" className="btn btn-sm">Till dina filmer</Link>}
          />
        </div>
      ) : (
        <div className="mt-[18px] space-y-[18px]">
          {months.map(month => (
            <section key={month.key}>
              <h2 className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-2">
                {month.label}
              </h2>
              <div className="flex flex-col gap-[6px]">
                {month.entries.map(({ item, date }) => {
                  const tone = item.genreIds.length > 0
                    ? toneForGenreIds(item.genreIds)
                    : toneForId(item.tmdbId);
                  const poster = posterUrl(item.posterPath, 'w92');
                  return (
                    <Link
                      key={item.tmdbId}
                      href={titleHref('movie', item.tmdbId)}
                      className="flex items-center gap-[10px] bg-surface border border-rule rounded-sm px-[10px] py-[7px] no-underline hover:border-rule-2 transition-colors"
                    >
                      <div className={`poster duo-${tone} w-[34px] h-[51px] shrink-0`} style={{ aspectRatio: '2 / 3' }}>
                        {poster && (
                          <img src={poster} alt="" loading="lazy" decoding="async" width={34} height={51} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-text-primary truncate">{item.title}</div>
                        <div className="text-xxs text-text-muted">
                          {date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' })}
                          {item.releaseYear ? ` · ${item.releaseYear}` : ''}
                        </div>
                      </div>
                      {item.rating !== null && (
                        <span className="shrink-0 inline-flex items-center gap-[3px]">
                          <RatingStars rating={item.rating} readonly size="sm" />
                          <span className="text-xxs text-text-muted">{item.rating.toFixed(1)}</span>
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="text-xxs text-text-muted pt-2">
            Dagboken visar filmer du sett. Avsnitt per serie kommer senare.
          </p>
        </div>
      )}
    </div>
  );
}
