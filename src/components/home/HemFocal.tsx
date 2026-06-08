'use client';

import Link from 'next/link';
import { backdropUrl, posterUrl } from '@/lib/tmdb/client';
import { toneForId } from '@/lib/duotone';
import { shortSwedishWeekday } from '@/lib/utils';
import type { CalendarEntry } from '@/hooks/useCalendar';
import { entryHref } from '@/lib/calendar/entry';
import { daysFromToday } from './focalPick';

// The Hem focal block: 21:9 duotone still up top + a 2:3 poster overlapping
// the bottom-left + a meta column + a CTA column. Designed for the "tonight
// or imminent" case from Direction H. Handles both TV episodes (shows you
// watch or want to see) and digital movie releases. Falls back to a
// poster-only still when TMDB has no backdrop/episode-still.

interface Props {
  entry: CalendarEntry;
}

function badgeForDay(days: number, isMovie: boolean): { label: string; live: boolean } {
  const head = isMovie ? 'släpps' : 'nytt avsnitt';
  if (days === 0) return { label: `i dag · ${head}`, live: true };
  if (days === 1) return { label: 'i morgon', live: false };
  return { label: `om ${days} dagar`, live: false };
}

export default function HemFocal({ entry }: Props) {
  const isMovie = entry.kind === 'movie';
  const days = daysFromToday(entry.airDate);
  const tone = toneForId(entry.tmdbId);
  const still = backdropUrl(entry.backdropPath, 'w1280');
  const poster = posterUrl(entry.posterPath, 'w342');
  const badge = badgeForDay(days, isMovie);
  const href = entryHref(entry);
  const dayLabel = shortSwedishWeekday(entry.airDate).toUpperCase();
  // Synopsis-fält skiljer sig per kind.
  const headline = entry.kind === 'episode' ? entry.episodeName : undefined;
  const overview = entry.kind === 'episode' ? entry.episodeOverview : entry.overview;

  return (
    <article className="focal">
      <div className={`still duo-${tone}`}>
        {still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={still} alt="" loading="eager" decoding="async" width={1280} height={548} />
        ) : null}
        <div className="badge-stack">
          <span className={`b${badge.live ? ' live' : ''}`}>{badge.label}</span>
          {entry.provider && <span className="b">{entry.provider}</span>}
        </div>
      </div>

      <div className="body">
        <Link href={href} className={`px duo-${tone}`} aria-label={entry.title}>
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" loading="lazy" decoding="async" width={342} height={513} />
          ) : null}
        </Link>

        <div className="meta-col">
          <div className="ch-line">
            {days === 0 ? (
              <span className="live"><span className="live-dot" aria-hidden="true" />{' '}aktivt nu</span>
            ) : (
              <span>{dayLabel} {new Date(entry.airDate + 'T00:00:00').getDate()}</span>
            )}
            {entry.provider && <span>{entry.provider}</span>}
            <span>{entry.kind === 'movie' ? 'digital release' : `avsnitt ${entry.episodeCode}`}</span>
          </div>
          <h2>
            <Link href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
              {entry.title}
            </Link>
          </h2>
          {headline && (
            <p className="syn">
              <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{headline}</strong>
              {overview ? ` — ${overview}` : ''}
            </p>
          )}
          {!headline && overview && (
            <p className="syn">{overview}</p>
          )}
          <div className="stats">
            {entry.kind === 'movie' ? (
              <span><span className="k">release</span><strong>digital</strong></span>
            ) : (
              <span><span className="k">avsnitt</span><strong>{entry.episodeCode}</strong></span>
            )}
            {entry.runtime ? (
              <span><span className="k">tid</span><strong>{entry.runtime} min</strong></span>
            ) : null}
            {entry.provider ? (
              <span><span className="k">tillgång</span><strong>{entry.provider}</strong></span>
            ) : null}
          </div>
        </div>

        <div className="cta">
          <Link href={href} className="btn">{isMovie ? 'Öppna filmen' : 'Öppna serien'}</Link>
          <Link href="/calendar/" className="btn btn-ghost btn-sm">Se hela veckan</Link>
        </div>
      </div>
    </article>
  );
}
