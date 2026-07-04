'use client';

import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import { toneForGenreIds } from '@/lib/duotone';
import { entryHref, entryBadge } from '@/lib/calendar/entry';
import type { CalendarEntry } from '@/lib/calendar/types';
import type { DiscoveryPremiere } from '@/lib/calendar/premieres';

// Kompakt listrad för kvartalsvyn — horisontell (mini-poster · titel/datum ·
// badge), till skillnad från EventCard som är ett 16:9-kort. Delar badge-
// vokabulär (premiär / ny säsong / säsongsfinal) via entryBadge så termerna ser
// likadana ut som i veckovyn. Dagens rad bär en plum-inset (tvåaccentregeln:
// plum = tidposition, aldrig saffran).

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }).replace('.', '');
}

function Poster({ path, tone }: { path: string | null; tone: string }) {
  const src = posterUrl(path, 'w92');
  return (
    <div className={`prow-px duo-${tone}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" width={46} height={69} />
      ) : null}
    </div>
  );
}

export function PremiereRow({ entry, isToday = false }: { entry: CalendarEntry; isToday?: boolean }) {
  const tone = toneForGenreIds(entry.genreIds);
  const badge = entryBadge(entry, isToday);
  return (
    <Link href={entryHref(entry)} className={`prow no-underline${isToday ? ' is-today' : ''}`}>
      <Poster path={entry.posterPath} tone={tone} />
      <div className="prow-body">
        <div className="prow-ttl">{entry.title}</div>
        <div className="prow-meta">
          <span>{fmtDate(entry.airDate)}</span>
          {entry.provider ? <> · <span className="ch">{entry.provider}</span></> : null}
        </div>
      </div>
      {badge && <span className="prow-badge">{badge}</span>}
    </Link>
  );
}

export function DiscoveryRow({ premiere }: { premiere: DiscoveryPremiere }) {
  const tone = toneForGenreIds(premiere.genreIds);
  return (
    <Link href={`/tv/${premiere.tmdbId}/`} className="prow no-underline">
      <Poster path={premiere.posterPath} tone={tone} />
      <div className="prow-body">
        <div className="prow-ttl">{premiere.title}</div>
        <div className="prow-meta">
          <span>{fmtDate(premiere.firstAirDate)}</span>
        </div>
      </div>
      <span className="prow-badge">premiär</span>
    </Link>
  );
}
