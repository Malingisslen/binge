'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import ProviderDot from '@/components/ui/ProviderDot';
import SrOnlyTableHeader from '@/components/ui/SrOnlyTableHeader';
import dynamic from 'next/dynamic';
import DiagnosisCard from '@/components/savings/DiagnosisCard';
import CampaignExpiryNudges from '@/components/savings/CampaignExpiryNudges';
import NumberedActionsList from '@/components/savings/NumberedActionsList';
import BundleArbitrageCard from '@/components/savings/BundleArbitrageCard';
import ProvidersByValue from '@/components/savings/ProvidersByValue';
import ServiceValueCard from '@/components/savings/ServiceValueCard';
import CoverageOptimizer from '@/components/savings/CoverageOptimizer';
import RotationPlanner from '@/components/savings/RotationPlanner';
import RotationCalendar from '@/components/savings/RotationCalendar';
import SavingsSidebar from '@/components/savings/SavingsSidebar';
import UpcomingEpisodes from '@/components/savings/UpcomingEpisodes';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import { useAuth } from '@/hooks/useAuth';
import { trackEvent } from '@/lib/analytics';
import { titleHref } from '@/lib/tmdb/client';
import { formatSwedishDate } from '@/lib/utils';
import type { AdvisedShow, ActivePause, SubscribeAdvisory } from '@/types';

const LOOK_AHEAD_DAYS = 60;

const AdvisorTimeline = dynamic(() => import('@/components/savings/AdvisorTimeline'), { ssr: false });
const WillSeePerProvider = dynamic(() => import('@/components/savings/WillSeePerProvider'), { ssr: false });

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
    <div className="bg-surface border border-rule rounded-sm overflow-hidden">
      <table className="w-full border-collapse">
        <SrOnlyTableHeader columns={['Titel', 'Typ', 'Tjänst', 'Status']} />
        <tbody>
          {rows.map(({ show, provider }) => {
            const href = titleHref(show.mediaType, show.tmdbId);
            return (
              <tr key={`${provider.providerId}-${show.tmdbId}`} className="border-b border-rule-2 last:border-b-0">
                <td className="px-3 py-[6px] text-xs font-semibold">
                  <Link href={href} className="no-underline text-ink hover:text-acc-deep">
                    {show.title}
                  </Link>
                </td>
                <td className="px-3 py-[6px] text-xxs text-ink-3 whitespace-nowrap">
                  {show.mediaType === 'movie' ? 'Film' : 'Serie'}
                </td>
                <td className="px-3 py-[6px] whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <ProviderDot color={provider.color} size={7} />
                    <span className="text-xs text-ink-2">{provider.shortName}</span>
                  </span>
                </td>
                <td className="px-3 py-[6px] text-xxs text-ink-3 text-right whitespace-nowrap">
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
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-ink-3">Dina pausade tjänster</h2>
        {totalSaved > 0 && (
          <span className="text-xxs text-season-done font-semibold">Sparat hittills: {totalSaved} kr</span>
        )}
      </div>
      <div className="bg-surface border border-rule rounded-sm overflow-hidden">
        <table className="w-full border-collapse">
          <SrOnlyTableHeader columns={['Tjänst', 'Pausad sedan', 'Sparat', 'Åtgärd']} />
          <tbody>
            {pauses.map(p => (
              <tr key={p.providerId} className="border-b border-rule-2 last:border-b-0">
                <td className="px-3 py-[6px] whitespace-nowrap">
                  <span className="inline-flex items-center gap-[6px]">
                    <ProviderDot color={p.color} size={7} />
                    <span className="text-xs font-semibold text-ink">{p.providerName}</span>
                  </span>
                </td>
                <td className="px-3 py-[6px] text-xxs text-ink-3">
                  Pausad {formatSwedishDate(p.pausedAt)}
                  {p.resumeAt ? ` · återuppta ${formatSwedishDate(p.resumeAt)}` : ''}
                </td>
                <td className="px-3 py-[6px] text-xxs text-season-done font-semibold text-right whitespace-nowrap">
                  +{p.savingsSoFar} kr
                </td>
                <td className="px-3 py-[6px] text-right">
                  <button
                    onClick={() => onResume(p.providerId)}
                    className="text-xxs text-acc-deep no-underline font-[inherit] bg-transparent border-none cursor-pointer"
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
  const { pauseProvider, resumeProvider, profileLoading } = useAuth();
  const hasAdvisorProviders = advisor.providers.length > 0;
  // En-skott per sidladd: fyr 'advisor_viewed' bara första gången rådgivaren
  // är klar med providers. Utan guarden skulle providerCount-ändringar (t.ex.
  // efter en pausning) re-fyra eventet och blåsa upp räkningen i Plausible.
  const advisorViewedRef = useRef(false);
  useEffect(() => {
    if (!advisor.isLoading && hasAdvisorProviders && !advisorViewedRef.current) {
      advisorViewedRef.current = true;
      trackEvent('advisor_viewed', { providerCount: advisor.providers.length });
    }
  }, [advisor.isLoading, hasAdvisorProviders, advisor.providers.length]);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // BIN-208: stamp "now" once per mount (lazy useState initializer) so the month
  // window is stable and useServiceValue's memo doesn't recompute every render
  // from a fresh Date.now().
  const [valueNowMs] = useState(() => Date.now());
  const handleShowSubscribeRows = () => {
    const el = detailsRef.current;
    if (!el) return;
    el.open = true;
    setDetailsOpen(true);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // A1/A2: gatea på isLoading ENSAMT. Tidigare villkor `&& providers.length
  // === 0` höll aldrig — providers byggs från user.myProviders och är icke-
  // tom redan vid första compute, så diagnos + steg-rader renderades från
  // partiell TMDB-data och flippade medan queries strömmade in. isLoading är
  // numera "allt avgjort"-flaggan (watchlist + samtliga detaljqueries).
  //
  // profileLoading: sedan auth-profilen laddas parallellt (icke-blockerande)
  // är myProviders [] tills profilen landat. Med persistentLocalCache
  // resolverar watchlisten direkt från disk, så advisor.isLoading kan bli
  // false (TV-löst bibliotek → inga detaljqueries) MEDAN providers ännu är
  // okända — utan den här gaten flashar "lägg till tjänster" till en användare
  // som faktiskt har tjänster. Samma profilgate som admin/insikter.
  if (advisor.isLoading || profileLoading) {
    return (
      <>
        <header>
          <div className="crumb">Streamingrådgivaren</div>
          <h1 className="page-h1">Streamingrådgivaren</h1>
        </header>
        <LoadingView label="Räknar på dina tjänster…" />
      </>
    );
  }

  if (advisor.providers.length === 0) {
    // BIN-442: `providers` härleds från TMDB-fan-outen och nollas vid ett totalt
    // fetch-fel (kall cache / TMDB nere). Paket-arbitrage beräknas DÄREMOT
    // fristående från ägda tjänster + kostnader (ingen TMDB) och överlever felet.
    // Så när det finns paketförslag HAR användaren bevisligen tjänster — visa
    // paketkortet istället för den missvisande "inga tjänster"-tomrutan, precis
    // som motorn ursprungligen konstruerades att fungera under ett TMDB-avbrott.
    if (advisor.bundleSuggestions.length > 0) {
      return (
        <>
          <header>
            <div className="crumb">Streamingrådgivaren</div>
            <h1 className="page-h1">Streamingrådgivaren</h1>
          </header>
          <div style={{ marginTop: 22 }}>
            <BundleArbitrageCard suggestions={advisor.bundleSuggestions} />
          </div>
        </>
      );
    }
    return (
      <>
        <header>
          <div className="crumb">Streamingrådgivaren</div>
          <h1 className="page-h1">Streamingrådgivaren</h1>
        </header>
        <EmptyState
          title="Inga tjänster tillagda än"
          body="Lägg till dina streamingtjänster så räknar vi ut vad du kan pausa och spara på."
          action={
            <Link href="/settings/" className="btn btn-ghost btn-sm">Lägg till tjänster</Link>
          }
        />
      </>
    );
  }

  const activeProviderCount = advisor.providers.length;

  const allSubscribeRows = advisor.subscribeAdvice
    .flatMap(sa => sa.shows.map(show => ({ show, provider: sa })))
    .sort((a, b) => {
      // Sort-last sentinel for shows with no next air date. '9999-12-31' sorts
      // after any real ISO date and survives text round-trips (unlike U+FFFF).
      const ad = a.show.nextAirDate ?? '9999-12-31';
      const bd = b.show.nextAirDate ?? '9999-12-31';
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

        <CampaignExpiryNudges />

        {advisor.activePauses.length > 0 && (
          <ActivePausesSection
            pauses={advisor.activePauses}
            onResume={(id) => { resumeProvider(id); trackEvent('advisor_action_taken', { action: 'resume', providerId: id }); }}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
          <div className="min-w-0">
            <NumberedActionsList
              advisor={advisor}
              onPauseProvider={(id, resumeAt) => { pauseProvider(id, resumeAt); trackEvent('advisor_action_taken', { action: 'pause', providerId: id }); }}
              onShowSubscribeRows={handleShowSubscribeRows}
            />

            <BundleArbitrageCard suggestions={advisor.bundleSuggestions} />

            <ProvidersByValue
              providers={advisor.providers}
              activePauses={advisor.activePauses}
            />

            <ServiceValueCard nowMs={valueNowMs} />

            <CoverageOptimizer rows={advisor.willSeeByProvider} />

            <RotationPlanner advisor={advisor} />

            <RotationCalendar />

            <UpcomingEpisodes />

            <details
              ref={detailsRef}
              className="mb-3 scroll-mt-3 mt-3"
              onToggle={e => setDetailsOpen((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary className="text-[11px] font-bold uppercase tracking-[0.5px] text-ink-3 cursor-pointer select-none list-none">
                Mer detaljer ›
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                {detailsOpen && <AdvisorTimeline />}
                {detailsOpen && <WillSeePerProvider rows={advisor.willSeeByProvider} />}
                {hasSubscribeDetails && (
                  <div>
                    <div className="flex items-baseline justify-between mb-[6px]">
                      <h3 className="text-[11px] font-bold uppercase tracking-[0.5px] text-ink-3">
                        Titlar på tjänster du inte har
                      </h3>
                      <span className="text-xxs text-ink-3">
                        {subscribeRows.length + datelessSubscribeRows.length} totalt
                      </span>
                    </div>
                    {subscribeRows.length > 0 && <SubscribeRowTable rows={subscribeRows} />}
                    {datelessSubscribeRows.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xxs text-ink-3 cursor-pointer select-none list-none">
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
