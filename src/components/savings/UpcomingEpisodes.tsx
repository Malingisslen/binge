'use client';

import Link from 'next/link';
import ProviderDot from '@/components/ui/ProviderDot';
import { useUpcomingShowsForAdvisor, type UpcomingEpisode, type UpcomingShow } from '@/hooks/useUpcomingShowsForAdvisor';
import { formatSwedishDate, pluralSv } from '@/lib/utils';
import { titleHref } from '@/lib/tmdb/client';

// Streamingrådgivaren · "Närmaste avsnitt"-listan (V1 — Per serie).
// En rad per serie där kommande air-datum visas som klickbara datum-pills.
// Konsekutiva datum bundlas till ranges (21/5–22/5) för att minska antalet
// pills. Tom lista renderar inget — sidan har en separat tom-state ovanför.

const WEEKS = 8;

interface DatePill {
  key: string;
  label: string;
  isToday: boolean;
  isFinale: boolean;
  episodes: UpcomingEpisode[];
}

function isConsecutiveDay(a: string, b: string): boolean {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return db - da === 86400000;
}

function dayMonth(iso: string): string {
  const day = +iso.slice(8, 10);
  const month = +iso.slice(5, 7);
  return `${day}/${month}`;
}

export function bundleEpisodes(episodes: UpcomingEpisode[]): DatePill[] {
  if (episodes.length === 0) return [];

  const groups: UpcomingEpisode[][] = [];
  let current: UpcomingEpisode[] = [episodes[0]];

  for (let i = 1; i < episodes.length; i++) {
    const prev = current[current.length - 1];
    const ep = episodes[i];
    // Bundla bara strikt konsekutiva dagar (a + 1 == b). "Idag" får aldrig
    // bundlas eftersom det får en egen specialetikett.
    const canBundle = isConsecutiveDay(prev.airDate, ep.airDate) && !prev.isToday && !ep.isToday;
    if (canBundle) {
      current.push(ep);
    } else {
      groups.push(current);
      current = [ep];
    }
  }
  groups.push(current);

  return groups.map((g, i) => {
    const first = g[0];
    const last = g[g.length - 1];
    const isToday = g.some(e => e.isToday);
    const isFinale = g.some(e => e.isFinale);
    let label: string;
    if (isToday && g.length === 1) {
      label = 'Idag';
    } else if (g.length > 1) {
      label = `${dayMonth(first.airDate)}–${dayMonth(last.airDate)}`;
    } else {
      label = dayMonth(first.airDate);
    }
    return {
      key: `${first.airDate}-${last.airDate}-${i}`,
      label,
      isToday,
      isFinale,
      episodes: g,
    };
  });
}

function buildTooltip(pill: DatePill, show: UpcomingShow): string {
  const lines = pill.episodes.map(e => {
    const date = formatSwedishDate(e.airDate);
    const code = e.episodeCode ? ` · ${e.episodeCode}` : '';
    const finale = e.isFinale ? ' · Säsongsfinal' : '';
    return `${date}${code}${finale}`;
  });
  return `${show.title}\n${lines.join('\n')}`;
}

const PILL_BASE = 'text-xxs font-semibold px-[7px] py-[2px] rounded-sm whitespace-nowrap transition-colors tabular-nums';

function pillClass(pill: DatePill): string {
  if (pill.isToday) {
    return `${PILL_BASE} bg-accent text-white border border-accent hover:bg-accent-deep`;
  }
  if (pill.isFinale) {
    // Finale-pill: utlinad i accent så slutavsnitt sticker ut utan att
    // konkurrera med "Idag" som är den enda fyllda orange pillen.
    return `${PILL_BASE} bg-surface text-accent border border-accent hover:bg-accent hover:text-white`;
  }
  return `${PILL_BASE} bg-bg-2 text-text-secondary border border-border-main hover:border-accent hover:text-accent`;
}

export default function UpcomingEpisodes() {
  const { shows, totalEpisodes, weeks, trailingQuietWeeks, isLoading } = useUpcomingShowsForAdvisor(WEEKS);

  // Tyst om vi laddar eller om det inte finns något att visa — vi vill
  // inte rendera en bandage-rubrik för en tom sektion.
  if (isLoading && shows.length === 0) return null;
  if (shows.length === 0) return null;

  const activeWeeks = weeks - trailingQuietWeeks;
  const summaryText = trailingQuietWeeks >= 3
    ? `${totalEpisodes} ${pluralSv(totalEpisodes, 'avsnitt', 'avsnitt')} fördelade på ${shows.length} ${pluralSv(shows.length, 'serie', 'serier')} de närmaste ${activeWeeks} ${pluralSv(activeWeeks, 'veckan', 'veckorna')} — sedan en lugn period på ${trailingQuietWeeks} ${pluralSv(trailingQuietWeeks, 'vecka', 'veckor')}.`
    : `${totalEpisodes} ${pluralSv(totalEpisodes, 'avsnitt', 'avsnitt')} fördelade på ${shows.length} ${pluralSv(shows.length, 'serie', 'serier')} de närmaste ${weeks} veckorna.`;

  return (
    <div className="mb-[14px]">
      <div className="flex items-baseline justify-between mb-[6px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">Närmaste avsnitt</h2>
        <span className="text-xxs text-text-muted">{totalEpisodes} avsnitt · {weeks} veckor</span>
      </div>

      <div className="bg-surface border border-border-main border-l-[3px] border-l-season-done rounded-sm px-3 py-[10px] mb-[6px]">
        <p className="text-xs text-text-secondary leading-[1.5]">{summaryText}</p>
      </div>

      <div className="bg-surface border border-border-main rounded-sm overflow-hidden">
        {shows.map(show => {
          const pills = bundleEpisodes(show.episodes);
          return (
            <div
              key={show.tmdbId}
              className="grid grid-cols-[1fr_auto] gap-3 px-3 py-[8px] items-center border-b border-border-light last:border-b-0"
            >
              <div className="flex items-center gap-[6px] min-w-0">
                <ProviderDot color={show.providerColor} size={7} />
                <Link
                  href={titleHref('tv', show.tmdbId)}
                  className="text-xs font-semibold text-text-primary truncate hover:text-accent no-underline"
                >
                  {show.title}
                </Link>
                <span className="text-xxs text-text-muted font-medium truncate">{show.providerShortName}</span>
              </div>
              <div className="flex gap-[3px] flex-wrap justify-end">
                {pills.map(pill => (
                  <Link
                    key={pill.key}
                    href="/calendar/"
                    title={buildTooltip(pill, show)}
                    className={`${pillClass(pill)} no-underline`}
                  >
                    {pill.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {trailingQuietWeeks >= 3 && (
        <div className="bg-surface border border-border-main border-l-[3px] border-l-border-main rounded-sm px-3 py-[8px] mt-[6px]">
          <p className="text-xs text-text-secondary">
            <strong className="text-text-primary">
              {trailingQuietWeeks} {pluralSv(trailingQuietWeeks, 'lugn vecka', 'lugna veckor')} framöver
            </strong>
            {' — bra läge att överväga en pausning när du är ikapp.'}
          </p>
        </div>
      )}

      <div className="text-center mt-2">
        <Link href="/calendar/" className="text-xxs text-accent font-semibold no-underline hover:underline">
          Visa full kalender →
        </Link>
      </div>
    </div>
  );
}
