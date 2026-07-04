'use client';

import AuthGuard from '@/components/AuthGuard';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import CalendarSubnav from '@/components/calendar/CalendarSubnav';
import { PremiereRow, DiscoveryRow } from '@/components/calendar/PremiereRow';
import { usePremiereEvents } from '@/hooks/usePremiereEvents';
import { useDiscoveryPremieres } from '@/hooks/useDiscoveryPremieres';
import { buildPremiererHeadline, buildPremiererStandfirst } from '@/lib/calendar/copy';
import { entryKey } from '@/lib/calendar/entry';

export default function PremiererPage() {
  return <AuthGuard><PremiererContent /></AuthGuard>;
}

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function PremiererContent() {
  const { window, groups, counts, isLoading } = usePremiereEvents();
  const discovery = useDiscoveryPremieres(window);
  const today = todayIso();

  const headline = buildPremiererHeadline(counts);
  const standfirst = buildPremiererStandfirst(counts, window.endIso);

  return (
    <>
      <PageHeader
        crumb="Kalender · premiärer & finaler · 13 veckor"
        title="Premiärer & finaler"
        standfirst={standfirst}
      />
      <CalendarSubnav active="premiarer" />

      {isLoading ? (
        <LoadingView label="Hämtar premiärer och finaler…" variant="detail" />
      ) : (
        <>
          <h2 className="sr-only">{headline}</h2>
          {groups.length === 0 ? (
            <div style={{ marginTop: 16 }}>
              <EmptyState
                title="Inga premiärer eller finaler på gång"
                body="Vi hittade inga säsongspremiärer, finaler eller filmsläpp för dina serier de kommande tre månaderna. Upptäck stora kommande premiärer nedan."
              />
            </div>
          ) : (
            groups.map(group => (
              <section key={group.key} style={{ marginTop: 24 }}>
                <h2 className="cal-month-h">{group.label}</h2>
                <div className="prow-list">
                  {group.entries.map(entry => (
                    <PremiereRow
                      key={entryKey(entry)}
                      entry={entry}
                      isToday={entry.airDate === today}
                    />
                  ))}
                </div>
              </section>
            ))
          )}

          <DiscoverySection discovery={discovery} />
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <JustWatchCredit />
      </div>
    </>
  );
}

function DiscoverySection({ discovery }: { discovery: ReturnType<typeof useDiscoveryPremieres> }) {
  // Upptäckts-sektionen är TYDLIGT icke-personlig: egen rubrik + framing-text
  // ("som du inte följer än") så den aldrig läses som "dina premiärer" — särskilt
  // i noll-följer-läget där EmptyState och den här ligger på samma skärm.
  if (discovery.isLoading) {
    return (
      <section style={{ marginTop: 32 }}>
        <h2 className="cal-month-h">Upptäck — stora premiärer</h2>
        <LoadingView label="Hämtar kommande premiärer…" variant="inline" />
      </section>
    );
  }
  if (discovery.premieres.length === 0) return null;
  return (
    <section style={{ marginTop: 32 }}>
      <h2 className="cal-month-h">Upptäck — stora premiärer</h2>
      <p className="stand" style={{ marginTop: 2, marginBottom: 12 }}>
        Stora kommande seriepremiärer du inte följer än.
      </p>
      <div className="prow-list">
        {discovery.premieres.map(premiere => (
          <DiscoveryRow key={premiere.tmdbId} premiere={premiere} />
        ))}
      </div>
    </section>
  );
}
