'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Film, Tv } from 'lucide-react';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { useAuth } from '@/hooks/useAuth';
import { getProvider } from '@/lib/tmdb/providers';
import { shortSwedishWeekday, daysBetween, todayIso } from '@/lib/utils';
import RatingStars from '@/components/title/RatingStars';
import type { WatchlistItem, TvSubState } from '@/types';

function upcomingWeekday(isoDate: string | undefined): string | null {
  if (!isoDate) return null;
  if (isoDate < todayIso()) return null;
  if (daysBetween(todayIso(), new Date(isoDate + 'T00:00:00')) > 4) return null;
  return shortSwedishWeekday(isoDate);
}

/**
 * Watchlist-kort för cards-vyn. Visar poster, titel, rating, providers +
 * progressbar för TV-serier. "Nytt mån"-chippet highlightar avsnitt som
 * sänds inom 4 dagar (upcomingWeekday-tröskeln).
 */
export function WatchlistCard({
  item,
  nextAirDate,
  subState,
}: {
  item: WatchlistItem;
  nextAirDate?: string;
  // Aktiv/Ikapp/Avslutad — passas in från WatchlistPage som redan beräknat
  // det via bucketBySubState. Skippas för film och för icke-/my/series-vyer.
  subState?: TvSubState;
}) {
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];
  const poster = posterUrl(item.posterPath, 'w185');
  const href = titleHref(item.mediaType, item.tmdbId);
  const Icon = item.mediaType === 'tv' ? Tv : Film;

  const progressPct = useMemo(() => {
    if (item.mediaType !== 'tv') return null;
    if (item.status === 'sedd') return 100;
    if (!item.totalSeasons || !item.lastWatchedSeason) return 0;
    const seasonPart = (item.lastWatchedSeason - 1) / item.totalSeasons;
    const episodePart = item.lastWatchedEpisode ? 1 / (item.totalSeasons * 20) : 0;
    return Math.min(100, Math.round((seasonPart + episodePart) * 100));
  }, [item]);

  const upcomingWd = upcomingWeekday(nextAirDate);
  const progressLabel: { text: string; tone: 'done' | 'accent' | 'muted' } = (() => {
    if (item.mediaType === 'movie') {
      return { text: item.status === 'sedd' ? 'Sedd' : '—', tone: item.status === 'sedd' ? 'done' : 'muted' };
    }
    // TV. Sub-state-driven labels när vi vet sub-state — annars fall tillbaka
    // till legacy/heuristik så icke-/my/series-vyer (t.ex. /my/all) också får
    // rimlig text.
    if (subState === 'avslutad') return { text: 'Avslutad', tone: 'done' };
    if (subState === 'aktiv' && item.lastWatchedSeason) {
      return { text: `Bakom · S${item.lastWatchedSeason}`, tone: 'accent' };
    }
    if (subState === 'ikapp') {
      return { text: upcomingWd ? `Nytt ${upcomingWd.toLowerCase()}` : 'Ikapp', tone: upcomingWd ? 'accent' : 'done' };
    }
    if (upcomingWd) return { text: `Nytt ${upcomingWd.toLowerCase()}`, tone: 'accent' };
    if (!item.totalSeasons) return { text: '—', tone: 'muted' };
    if (item.lastWatchedSeason) return { text: `Pågår S${item.lastWatchedSeason}`, tone: 'muted' };
    return { text: 'Ej påbörjad', tone: 'muted' };
  })();

  const providersToShow = item.providers.slice(0, 3);

  return (
    <div className="bg-surface border border-border-main rounded-sm p-[10px] flex gap-[10px] hover:border-accent/40 transition-colors">
      <Link href={href} className="shrink-0">
        {poster ? (
          <img src={poster} alt="" className="w-[50px] h-[75px] rounded-sm object-cover" loading="lazy" decoding="async" width={50} height={75} />
        ) : (
          <div className="w-[50px] h-[75px] rounded-sm bg-[#ddd8d0] flex items-center justify-center">
            <Icon size={16} className="text-text-muted opacity-40" />
          </div>
        )}
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <Link href={href} className="no-underline text-text-primary min-w-0">
            <div className="text-xs font-semibold truncate">{item.title}</div>
          </Link>
          <span className="shrink-0">
            {item.rating !== null ? (
              <span className="inline-flex items-center gap-[3px]">
                <RatingStars rating={item.rating} readonly size="sm" />
                <span className="text-xxs text-text-muted">{item.rating.toFixed(1)}</span>
              </span>
            ) : (
              <span className="text-xxs text-text-muted/60">Ej betygsatt</span>
            )}
          </span>
        </div>
        <div className="text-xxs text-text-muted mt-[1px]">
          {item.releaseYear ?? '—'}
          {item.mediaType === 'tv' && item.totalSeasons ? ` · ${item.totalSeasons} säsong${item.totalSeasons === 1 ? '' : 'er'}` : ''}
        </div>
        {providersToShow.length > 0 && (
          <div className="mt-[4px] flex flex-wrap gap-[2px]">
            {providersToShow.map(id => {
              const p = getProvider(id);
              if (!p) return null;
              const isMine = myProviders.includes(id);
              return (
                <span
                  key={id}
                  className={`text-xxs px-1 py-[1px] border rounded-sm inline-block ${
                    isMine ? 'border-accent text-accent' : 'border-border-main text-text-muted'
                  }`}
                >
                  {p.shortName}
                </span>
              );
            })}
          </div>
        )}
        {item.mediaType === 'tv' && (
          <div className="mt-[5px] flex items-center gap-[6px]">
            <div className="flex-1 h-[3px] bg-[#eee] rounded-sm overflow-hidden">
              <div
                className={`h-full ${progressLabel.tone === 'done' ? 'bg-[#2e7d32]' : 'bg-accent'}`}
                style={{ width: `${progressPct ?? 0}%` }}
              />
            </div>
            <span className={`text-xxs ${
              progressLabel.tone === 'done' ? 'text-[#2e7d32]'
              : progressLabel.tone === 'accent' ? 'text-accent font-semibold'
              : 'text-text-muted'
            }`}>
              {progressLabel.text}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
