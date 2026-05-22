'use client';

import Link from 'next/link';
import { shortSwedishWeekday } from '@/lib/utils';
import type { CalendarEntry } from '@/hooks/useCalendar';
import { daysFromToday } from './focalPick';

// Page-header for Hem: crumb (mono uppercase) → page-h1 → standfirst →
// actions row. The h1/standfirst is derived from the focal episode if any;
// without one, we fall back to a "how's your week looking?" prompt.

interface Props {
  focal: CalendarEntry | null;
  totalThisWeek: number;
  hasLibrary: boolean;
  isLoading?: boolean;
}

function buildCopy(entry: CalendarEntry | null, totalThisWeek: number, isLoading: boolean): {
  crumb: string;
  h1: string;
  stand: string;
} {
  if (!entry) {
    if (isLoading) {
      // Under loading visar vi *inte* "En lugn vecka" — det är fel signal när
      // kalendern ännu inte har resolverat. En neutral crumb + diskret stand
      // håller utrymmet utan att lova något om innehållet.
      return {
        crumb: 'Hem · denna vecka',
        h1: 'Hämtar din vecka…',
        stand: 'Tittar igenom dina serier för att hitta nästa avsnitt.',
      };
    }
    return {
      crumb: 'Hem · denna vecka',
      h1: totalThisWeek > 0
        ? `${totalThisWeek} avsnitt denna vecka.`
        : 'En lugn vecka.',
      stand: totalThisWeek > 0
        ? 'Inget i kväll — men ditt schema är inte tomt. Kolla veckan nedan.'
        : 'Inget på schemat. Bra läge för att hitta något nytt.',
    };
  }

  const days = daysFromToday(entry.airDate);
  const weekday = shortSwedishWeekday(entry.airDate);

  if (days === 0) {
    return {
      crumb: `Hem · i dag · ${entry.provider ?? 'tillgängligt'}`,
      h1: `Ett nytt avsnitt av ${entry.title}.`,
      stand: entry.runtime
        ? `Sänds i kväll på ${entry.provider ?? 'din tjänst'}. Avsnittet är ${entry.runtime} minuter.`
        : `Sänds i kväll på ${entry.provider ?? 'din tjänst'}.`,
    };
  }

  if (days === 1) {
    return {
      crumb: `Hem · i morgon · ${entry.provider ?? 'tillgängligt'}`,
      h1: `${entry.title} kommer i morgon.`,
      stand: `Nästa avsnitt sänds ${weekday} på ${entry.provider ?? 'din tjänst'}.`,
    };
  }

  return {
    crumb: `Hem · ${weekday} · ${entry.provider ?? 'tillgängligt'}`,
    h1: `${entry.title} ${days <= 7 ? 'i veckan' : 'nästa vecka'}.`,
    stand: `Nästa avsnitt sänds ${weekday} på ${entry.provider ?? 'din tjänst'}.`,
  };
}

export default function HemHero({ focal, totalThisWeek, hasLibrary, isLoading = false }: Props) {
  const copy = buildCopy(focal, totalThisWeek, isLoading);

  return (
    <header>
      <div className="crumb">{copy.crumb}</div>
      <h1 className="page-h1">{copy.h1}</h1>
      <p className="stand">{copy.stand}</p>
      <div className="actions">
        {isLoading && !focal ? (
          // Inga CTA:er under loading — vi vet inte om kalendern är tom eller
          // full än, så vi ska inte föreslå "rekommendationer" eller liknande.
          null
        ) : focal ? (
          <>
            <Link href={`/tv/${focal.tmdbId}/`} className="btn btn-acc">
              Öppna {focal.title}
            </Link>
            <Link href="/calendar/" className="btn btn-ghost">Hela kalendern</Link>
          </>
        ) : hasLibrary ? (
          <>
            <Link href="/calendar/" className="btn">Visa kalendern</Link>
            <Link href="/recommendations/" className="btn btn-ghost">Rekommendationer</Link>
          </>
        ) : (
          <>
            <Link href="/series/" className="btn">Hitta serier</Link>
            <Link href="/films/" className="btn btn-ghost">Hitta filmer</Link>
          </>
        )}
      </div>
    </header>
  );
}
