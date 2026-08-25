'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAllEpisodeProgress } from '@/hooks/useAllEpisodeProgress';
import { PageHeader } from '@/components/layout/PageHeader';
import { LibrarySubnav } from '@/components/WatchlistPage';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import { seenDate } from '@/lib/seenDate';
import RatingStars from '@/components/title/RatingStars';
import { buildDiary, diaryEntryCount } from '@/lib/diary';
import { computeBingeStats } from '@/lib/bingeStats';

function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-surface border border-rule rounded-md px-[12px] py-[8px] min-w-[92px]">
      <div className="text-[20px] font-bold text-ink leading-none tabular-nums">{value}</div>
      <div className="text-xxs text-ink-3 mt-[3px]">{label}</div>
    </div>
  );
}

// BIN-103 — activity diary. Reverse-chron list of watched films (by watchedAt)
// merged with watched TV episodes (per-show episodeProgress), grouped by month.
// Films are free from the loaded watchlist; episodes are one cached collection
// read. The payoff of editable watch dates (BIN-91).
export default function DiaryPageClient() {
  const { items, loading } = useWatchlist();
  const { episodes, episodesLoading } = useAllEpisodeProgress();
  const months = useMemo(() => buildDiary(items, episodes), [items, episodes]);
  const total = diaryEntryCount(months);

  const films = useMemo(
    () => items.flatMap(i => {
      const watchedAt = i.mediaType === 'movie' ? seenDate(i) : null;
      return watchedAt ? [{ watchedAt }] : [];
    }),
    [items],
  );
  // BIN-102 — binge stats from the same watch data already loaded here.
  const stats = useMemo(() => computeBingeStats(episodes, films, new Date()), [episodes, films]);
  const hasStats = stats.currentStreakDays > 0 || stats.biggestDayEpisodes >= 2 || stats.episodesLast30 > 0;

  return (
    <div>
      <PageHeader
        crumb="Bibliotek"
        title="Dagbok"
        standfirst={total > 0
          ? `${total} ${total === 1 ? 'inlägg' : 'inlägg'} — senast först.`
          : 'Din tittarhistorik — filmer och avsnitt, när du såg vad.'}
      />
      <LibrarySubnav activeKey="diary" />

      {loading || episodesLoading ? (
        <LoadingView variant="grid" />
      ) : total === 0 ? (
        <div className="mt-[18px]">
          <EmptyState
            icon={<BookOpen size={28} />}
            title="Inga daterade visningar än"
            body="När du markerar en film som sedd eller bockar av ett avsnitt sparas datumet här. Filmers datum kan du backdatera i efterhand — avsnitt stämplas med dagens datum när du bockar av dem."
            action={<Link href="/my/films/" className="btn btn-sm">Till dina filmer</Link>}
          />
        </div>
      ) : (
        <div className="mt-[18px] space-y-[18px]">
          {hasStats && (
            <div className="flex flex-wrap gap-[8px]">
              {stats.currentStreakDays > 0 && (
                <StatBox value={stats.currentStreakDays} label={stats.currentStreakDays === 1 ? 'dag i rad' : 'dagar i rad'} />
              )}
              {stats.biggestDayEpisodes >= 2 && (
                <StatBox value={stats.biggestDayEpisodes} label="avsnitt på en dag" />
              )}
              {stats.episodesLast30 > 0 && (
                <StatBox value={stats.episodesLast30} label="avsnitt senaste 30 dagarna" />
              )}
            </div>
          )}
          {months.map(month => (
            <section key={month.key}>
              <h2 className="text-xxs uppercase tracking-[0.5px] text-ink-3 font-semibold mb-2">
                {month.label}
              </h2>
              <div className="flex flex-col gap-[6px]">
                {month.entries.map(({ item, date, episodeCode }) => {
                  const tone = item.genreIds.length > 0
                    ? toneForGenreIds(item.genreIds)
                    : toneForId(item.tmdbId);
                  const poster = posterUrl(item.posterPath, 'w92');
                  return (
                    <Link
                      key={`${item.tmdbId}-${episodeCode ?? 'film'}`}
                      href={titleHref(item.mediaType, item.tmdbId)}
                      className="flex items-center gap-[10px] bg-surface border border-rule rounded-sm px-[10px] py-[7px] no-underline hover:border-rule-2 transition-colors"
                    >
                      <div className={`poster duo-${tone} w-[34px] h-[51px] shrink-0`} style={{ aspectRatio: '2 / 3' }}>
                        {poster && (
                          <img src={poster} alt="" loading="lazy" decoding="async" width={34} height={51} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-ink truncate">{item.title}</div>
                        <div className="text-xxs text-ink-3">
                          {date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' })}
                          {episodeCode ? ` · ${episodeCode}` : item.releaseYear ? ` · ${item.releaseYear}` : ''}
                        </div>
                      </div>
                      {!episodeCode && item.rating !== null && (
                        <span className="shrink-0 inline-flex items-center gap-[3px]">
                          <RatingStars rating={item.rating} readonly size="sm" />
                          <span className="text-xxs text-ink-3">{item.rating.toFixed(1)}</span>
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
