'use client';

import { useRef } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import ProviderDot from '@/components/ui/ProviderDot';
import SrOnlyTableHeader from '@/components/ui/SrOnlyTableHeader';
import AdvisorTimeline from '@/components/savings/AdvisorTimeline';
import DiagnosisCard from '@/components/savings/DiagnosisCard';
import NumberedActionsList from '@/components/savings/NumberedActionsList';
import ProvidersByValue from '@/components/savings/ProvidersByValue';
import SavingsSidebar from '@/components/savings/SavingsSidebar';
import UpcomingEpisodes from '@/components/savings/UpcomingEpisodes';
import WillSeePerProvider from '@/components/savings/WillSeePerProvider';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import { useAuth } from '@/hooks/useAuth';
import { titleHref } from '@/lib/tmdb/client';
import { formatSwedishDate } from '@/lib/utils';
import type { AdvisedShow, ActivePause, SubscribeAdvisory } from '@/types';

const LOOK_AHEAD_DAYS = 60;

export default function SavingsPage() {
  return <AuthGuard><SavingsContent /></AuthGuard>;
}

// ---- Återanvänd: SubscribeRowTable och dess helpers (för "Mer detaljer") ----

function subscribeRowStatusText(show: AdvisedShow): string {
  if (show.mediaType === 'movie') {
    const year = show.releaseDate?.substring(0, 4);
    if (year && Number(year) > new Date().getFullYear()) return `Släpps ${year}`;
    return 'Streamar nu';
  }
  if (show.isEnded) return 'Avslutad';
  if (show.nextAirDate) return `Nytt avsnitt ${formatSwedishDate(show.nextAirDate)}`;
  return 'Okänt datum';
}

function hasConcreteStatus(show: AdvisedShow): boolean {
  if (show.mediaType === 'movie') return true;
  if (show.isEnded) return false;
  return show.nextAirDate != null;
}

interface SubscribeRow {
  show: AdvisedShow;
  provider: SubscribeAdvisory;
}

function SubscribeRowTable({ rows }: { rows: SubscribeRow[] }) {
  return (
    <div className="bg-surface border border-border-main rounded-sm overflow-hidden">
      <table className="w-full border-collapse">
        <SrOnlyTableHeader columns={['Titel', 'Typ', 'Tjänst', 'Status']} />
        <tbody>
          {rows.map(({ show, provider }) => {
            const href = titleHref(show.mediaType, show.tmdbId);
            return (
              <tr key={`${provider.providerId}-${show.tmdbId}`} className="border-b border-border-light last:border-b-0">
                <td className="px-3 py-[6px] text-xs font-semibold">
                  <Link href={href} className="no-underline text-text-primary hover:text-accent">
                    {show.title}
                  </Link>
                </td>
                <td className="px-3 py-[6px] text-xxs text-text-muted whitespace-nowrap">
                  {show.mediaType === 'movie' ? 'Film' : 'Serie'}
                </td>
                <td className="px-3 py-[6px] whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <ProviderDot color={provider.color} size={7} />
                    <span className="text-xs text-text-secondary">{provider.shortName}</span>
                  </span>
                </td>
                <td className="px-3 py-[6px] text-xxs text-text-muted text-right whitespace-nowrap">
                  {subscribeRowStatusText(show)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Återanvänd: ActivePausesSection (oförändrad) ----

function ActivePausesSection({ pauses, onResume }: { pauses: ActivePause[]; onResume: (id: number) => void }) {
  if (pauses.length === 0) return null;
  const totalSaved = pauses.reduce((sum, p) => sum + p.savingsSoFar, 0);
  return (
    <div className="mb-[14px]">
      <div className="flex items-baseline justify-between mb-[6px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">Dina pausade tjänster</h2>
        {totalSaved > 0 && (
          <span className="text-xxs text-season-done font-semibold">Sparat hittills: {totalSaved} kr</span>
        )}
      </div>
      <div className="bg-surface border border-border-main rounded-sm overflow-hidden">
        <table className="w-full border-collapse">
          <SrOnlyTableHeader columns={['Tjänst', 'Pausad sedan', 'Sparat', 'Åtgärd']} />
          <tbody>
            {pauses.map(p => (
              <tr key={p.providerId} className="border-b border-border-light last:border-b-0">
                <td className="px-3 py-[6px] whitespace-nowrap">
                  <span className="inline-flex items-center gap-[6px]">
                    <ProviderDot color={p.color} size={7} />
                    <span className="text-xs font-semibold text-text-primary">{p.providerName}</span>
                  </span>
                </td>
                <td className="px-3 py-[6px] text-xxs text-text-muted">
                  Pausad {formatSwedishDate(p.pausedAt)}
                  {p.resumeAt ? ` · återuppta ${formatSwedishDate(p.resumeAt)}` : ''}
                </td>
                <td className="px-3 py-[6px] text-xxs text-season-done font-semibold text-right whitespace-nowrap">
                  +{p.savingsSoFar} kr
                </td>
                <td className="px-3 py-[6px] text-right">
                  <button
                    onClick={() => onResume(p.providerId)}
                    className="text-xxs text-accent no-underline font-[inherit] bg-transparent border-none cursor-pointer"
                  >
                    Återuppta
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SavingsContent() {
  const advisor = useSubscriptionAdvisor(LOOK_AHEAD_DAYS);
  const { pauseProvider, resumeProvider } = useAuth();
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const handleShowSubscribeRows = () => {
    const el = detailsRef.current;
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (advisor.isLoading && advisor.providers.length === 0) {
    return (
      <header>
        <div className="crumb">Streamingrådgivaren</div>
        <h1 className="page-h1">Streamingrådgivaren</h1>
        <p className="stand">Räknar…</p>
      </header>
    );
  }

  if (advisor.providers.length === 0) {
    return (
      <header>
        <div className="crumb">Streamingrådgivaren</div>
        <h1 className="page-h1">Streamingrådgivaren</h1>
        <p className="stand">
          Lägg till tjänster i <Link href="/settings/" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--rule)' }}>inställningar</Link> för
          att få rådgivning om vad du kan pausa och spara på.
        </p>
      </header>
    );
  }

  const activeProviderCount = advisor.providers.length;

  const allSubscribeRows = advisor.subscribeAdvice
    .flatMap(sa => sa.shows.map(show => ({ show, provider: sa })))
    .sort((a, b) => {
      const ad = a.show.nextAirDate ?? '￿';
      const bd = b.show.nextAirDate ?? '￿';
      return ad.localeCompare(bd);
    });
  const subscribeRows = allSubscribeRows.filter(r => hasConcreteStatus(r.show));
  const datelessSubscribeRows = allSubscribeRows.filter(r => !hasConcreteStatus(r.show));
  const hasSubscribeDetails = subscribeRows.length > 0 || datelessSubscribeRows.length > 0;

  return (
    <>
      <header>
        <div className="crumb">Streamingrådgivaren · {activeProviderCount} tjänster</div>
        <h1 className="page-h1">Streamingrådgivaren</h1>
      </header>
      <div style={{ marginTop: 22 }}>
        <DiagnosisCard advisor={advisor} activeProviderCount={activeProviderCount} />

        {advisor.activePauses.length > 0 && (
          <ActivePausesSection
            pauses={advisor.activePauses}
            onResume={(id) => resumeProvider(id)}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
          <div className="min-w-0">
            <NumberedActionsList
              advisor={advisor}
              onPauseProvider={(id, resumeAt) => pauseProvider(id, resumeAt)}
              onShowSubscribeRows={handleShowSubscribeRows}
            />

            <ProvidersByValue
              providers={advisor.providers}
              activePauses={advisor.activePauses}
            />

            <UpcomingEpisodes />

            <details ref={detailsRef} className="mb-3 scroll-mt-3 mt-3">
              <summary className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted cursor-pointer select-none list-none">
                Mer detaljer ›
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <AdvisorTimeline />
                <WillSeePerProvider rows={advisor.willSeeByProvider} />
                {hasSubscribeDetails && (
                  <div>
                    <div className="flex items-baseline justify-between mb-[6px]">
                      <h3 className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">
                        Titlar på tjänster du inte har
                      </h3>
                      <span className="text-xxs text-text-muted">
                        {subscribeRows.length + datelessSubscribeRows.length} totalt
                      </span>
                    </div>
                    {subscribeRows.length > 0 && <SubscribeRowTable rows={subscribeRows} />}
                    {datelessSubscribeRows.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xxs text-text-muted cursor-pointer select-none list-none">
                          +{datelessSubscribeRows.length} utan spikat datum (avslutade / okänt) ›
                        </summary>
                        <div className="mt-1">
                          <SubscribeRowTable rows={datelessSubscribeRows} />
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            </details>
          </div>

          <SavingsSidebar
            advisor={advisor}
            activePauses={advisor.activePauses}
          />
        </div>

        <div style={{ marginTop: 16 }}>
          <JustWatchCredit />
        </div>
      </div>
    </>
  );
}
