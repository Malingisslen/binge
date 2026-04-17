'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import ProviderDot from '@/components/ui/ProviderDot';
import AdvisorTimeline from '@/components/savings/AdvisorTimeline';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { formatSwedishDate, addDaysFromToday, todayIso } from '@/lib/utils';
import type { PrimaryAction, ActivePause } from '@/types';

const LOOK_AHEAD_DAYS = 60;

export default function SavingsPage() {
  return <AuthGuard><SavingsContent /></AuthGuard>;
}

function PauseActionCard({ action, onPause }: { action: Extract<PrimaryAction, { kind: 'pause' }>; onPause: (id: number, resumeAt: string | null) => void }) {
  const [pauseOpen, setPauseOpen] = useState(false);
  const [resumeAt, setResumeAt] = useState<string>(action.nextAirDate ?? addDaysFromToday(30));
  const until = action.nextAirDate ? `tills ${formatSwedishDate(action.nextAirDate)}` : `i ${LOOK_AHEAD_DAYS} dagar framåt`;

  return (
    <div className="bg-surface border border-border-main border-l-[3px] border-l-[#2e7d32] rounded-sm p-4 mb-[14px]">
      <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-[#2e7d32] mb-1">Förslag</div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-base font-bold text-text-primary">
            Pausa {action.providerName} — spar {action.monthlyCost} kr/mån
          </div>
          <div className="text-xs text-text-muted mt-[2px]">
            Inga serier du följer sänder {until}.
          </div>
        </div>
        {!pauseOpen && (
          <button
            onClick={() => setPauseOpen(true)}
            className="px-3 py-[6px] bg-[#2e7d32] text-white border-none rounded-sm text-xs font-semibold font-[inherit] cursor-pointer"
          >
            Markera pausad
          </button>
        )}
      </div>
      {pauseOpen && (
        <div className="mt-3 pt-3 border-t border-border-light flex items-center gap-2 flex-wrap">
          <label className="text-xxs text-text-muted uppercase tracking-[0.5px] font-semibold">Återuppta</label>
          <input
            type="date"
            value={resumeAt}
            min={todayIso()}
            onChange={e => setResumeAt(e.target.value)}
            className="text-xs border border-border-main rounded-sm px-2 py-[3px] bg-surface text-text-primary font-[inherit] outline-none"
          />
          <div className="flex gap-[1px]">
            {action.nextAirDate && (
              <button
                onClick={() => setResumeAt(action.nextAirDate!)}
                className="px-[7px] py-[2px] text-xxs rounded-sm cursor-pointer font-[inherit] bg-surface border border-border-main text-text-muted"
              >
                Nästa avsnitt
              </button>
            )}
            <button
              onClick={() => setResumeAt(addDaysFromToday(30))}
              className="px-[7px] py-[2px] text-xxs rounded-sm cursor-pointer font-[inherit] bg-surface border border-border-main text-text-muted"
            >
              1 mån
            </button>
            <button
              onClick={() => setResumeAt(addDaysFromToday(90))}
              className="px-[7px] py-[2px] text-xxs rounded-sm cursor-pointer font-[inherit] bg-surface border border-border-main text-text-muted"
            >
              3 mån
            </button>
          </div>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => { setPauseOpen(false); onPause(action.providerId, null); }}
              className="px-2 py-[4px] text-xxs text-text-muted font-[inherit] bg-transparent border-none cursor-pointer"
            >
              Pausa tills vidare
            </button>
            <button
              onClick={() => { setPauseOpen(false); onPause(action.providerId, resumeAt); }}
              className="px-3 py-[5px] bg-[#2e7d32] text-white border-none rounded-sm text-xs font-semibold font-[inherit] cursor-pointer"
            >
              Bekräfta paus
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PrimaryActionCard({ action, onPause }: { action: PrimaryAction; onPause: (id: number, resumeAt: string | null) => void }) {
  if (action.kind === 'pause') {
    return <PauseActionCard action={action} onPause={onPause} />;
  }

  if (action.kind === 'catchup') {
    return (
      <div className="bg-surface border border-border-main border-l-[3px] border-l-accent rounded-sm p-4 mb-[14px]">
        <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-accent mb-1">Förslag</div>
        <div className="text-base font-bold text-text-primary">
          Titta klart på {action.providerName}
        </div>
        <div className="text-xs text-text-muted mt-[2px]">
          Du har {action.unfinishedCount} påbörjade serier här. Avsluta dem innan nästa pausningsfönster för att slippa betala för ett abonnemang du inte utnyttjar.
        </div>
      </div>
    );
  }

  if (action.kind === 'subscribe') {
    return (
      <div className="bg-surface border border-border-main border-l-[3px] border-l-accent rounded-sm p-4 mb-[14px]">
        <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-accent mb-1">Förslag</div>
        <div className="text-base font-bold text-text-primary">
          Prenumerera på {action.providerName}
        </div>
        <div className="text-xs text-text-muted mt-[2px]">
          {action.showCount} {action.showCount === 1 ? 'serie du följer' : 'serier du följer'} har nya avsnitt inom {LOOK_AHEAD_DAYS} dagar
          {action.nearestAirDate ? `, nästa ${formatSwedishDate(action.nearestAirDate)}` : ''}
          {action.monthlyCost > 0 ? ` · ${action.monthlyCost} kr/mån` : ''}.
        </div>
      </div>
    );
  }

  // idle
  return (
    <div className="bg-surface border border-border-main rounded-sm p-4 mb-[14px]">
      <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-text-muted mb-1">Allt är i sin ordning</div>
      <div className="text-base font-bold text-text-primary">Inget att agera på just nu</div>
      <div className="text-xs text-text-muted mt-[2px]">
        {action.nextCheckDate
          ? `Nästa översyn kring ${formatSwedishDate(action.nextCheckDate)} när något förändras.`
          : 'Vi hör av oss när något förändras i din följ-lista.'}
      </div>
    </div>
  );
}

function ActivePausesSection({ pauses, onResume }: { pauses: ActivePause[]; onResume: (id: number) => void }) {
  if (pauses.length === 0) return null;
  const totalSaved = pauses.reduce((sum, p) => sum + p.savingsSoFar, 0);
  return (
    <div className="mb-[14px]">
      <div className="flex items-baseline justify-between mb-[6px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">Dina pausade tjänster</h2>
        {totalSaved > 0 && (
          <span className="text-xxs text-[#2e7d32] font-semibold">Sparat hittills: {totalSaved} kr</span>
        )}
      </div>
      <div className="bg-surface border border-border-main rounded-sm overflow-hidden">
        <table className="w-full border-collapse">
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
                <td className="px-3 py-[6px] text-xxs text-[#2e7d32] font-semibold text-right whitespace-nowrap">
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
  const { getByStatus } = useWatchlist();
  const followedTvCount = getByStatus('följer', 'tv').filter(i => !i.dropped).length;

  if (advisor.isLoading && advisor.providers.length === 0) {
    return (
      <div>
        <h1 className="text-[18px] font-bold text-text-primary mb-3">Streamingrådgivare</h1>
        <p className="text-sm text-text-muted">Laddar...</p>
      </div>
    );
  }

  if (advisor.providers.length === 0) {
    return (
      <div>
        <h1 className="text-[18px] font-bold text-text-primary mb-3">Streamingrådgivare</h1>
        <p className="text-sm text-text-muted">
          <Link href="/settings" className="text-accent no-underline">Lägg till tjänster i inställningar</Link> för att se rådgivning.
        </p>
      </div>
    );
  }

  const activeProviders = advisor.providers.filter(p => p.status === 'active' || p.status === 'upcoming');
  const pauseProviders = advisor.providers.filter(p => p.status === 'pause');
  const userPausedSet = new Set(advisor.activePauses.map(p => p.providerId));
  const suggestedPauseCount = pauseProviders.filter(p => !userPausedSet.has(p.providerId)).length;

  const subscribeRows = advisor.subscribeAdvice
    .flatMap(sa => sa.shows.map(show => ({ show, provider: sa })))
    .sort((a, b) => {
      const ad = a.show.nextAirDate ?? '\uffff';
      const bd = b.show.nextAirDate ?? '\uffff';
      return ad.localeCompare(bd);
    });

  return (
    <div>
      <h1 className="text-[18px] font-bold text-text-primary mb-1">Streamingrådgivare</h1>
      <p className="text-xs text-text-muted mb-3">
        Analys av {activeProviders.length + pauseProviders.length} streamingtjänster baserat på följ-listan och &quot;Vill se&quot;.
      </p>

      <PrimaryActionCard
        action={advisor.primaryAction}
        onPause={(id, resumeAt) => pauseProvider(id, resumeAt)}
      />

      <ActivePausesSection
        pauses={advisor.activePauses}
        onResume={(id) => resumeProvider(id)}
      />

      <div className="grid grid-cols-3 gap-[10px] mb-4">
        <div className="bg-surface border border-border-main rounded-sm px-3 py-[10px]">
          <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-text-muted">Kostnad/mån</div>
          <div className="text-base font-bold text-text-primary mt-[2px]">
            {advisor.totalMonthlyCost > 0 ? `${advisor.totalMonthlyCost} kr` : <Link href="/settings" className="text-accent no-underline text-xs">Ange →</Link>}
          </div>
          {advisor.totalMonthlyCost > 0 && followedTvCount > 0 && (
            <div className="text-xxs text-text-muted mt-[2px]">
              ~{Math.round(advisor.totalMonthlyCost / followedTvCount)} kr per följd serie
            </div>
          )}
        </div>
        <div className="bg-surface border border-border-main rounded-sm px-3 py-[10px]">
          <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-text-muted">Kan pausas</div>
          <div className="text-base font-bold text-[#2e7d32] mt-[2px]">
            {suggestedPauseCount > 0 ? `${suggestedPauseCount} ${suggestedPauseCount === 1 ? 'tjänst' : 'tjänster'}` : '—'}
          </div>
        </div>
        <div className="bg-surface border border-border-main rounded-sm px-3 py-[10px]">
          <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-text-muted">Potentiell besparing/mån</div>
          <div className="text-base font-bold text-[#2e7d32] mt-[2px]">
            {advisor.monthlySavings > 0 ? `${advisor.monthlySavings} kr` : '—'}
          </div>
        </div>
      </div>

      <AdvisorTimeline />

      {subscribeRows.length > 0 && (
        <details className="mb-3">
          <summary className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted cursor-pointer select-none list-none">
            Serier på tjänster du inte har ({subscribeRows.length}) ›
          </summary>
          <p className="text-xxs text-text-muted mt-1 mb-2">Serier du följer som kräver en tjänst du inte har.</p>
          <div className="bg-surface border border-border-main rounded-sm overflow-hidden">
            <table className="w-full border-collapse">
              <tbody>
                {subscribeRows.map(({ show, provider }) => (
                  <tr key={`${provider.providerId}-${show.tmdbId}`} className="border-b border-border-light last:border-b-0">
                    <td className="px-3 py-[6px] text-xs font-semibold">
                      <Link href={`/tv/${show.tmdbId}`} className="no-underline text-text-primary hover:text-accent">
                        {show.title}
                      </Link>
                    </td>
                    <td className="px-3 py-[6px] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <ProviderDot color={provider.color} size={7} />
                        <span className="text-xs text-text-secondary">{provider.shortName}</span>
                      </span>
                    </td>
                    <td className="px-3 py-[6px] text-xxs text-text-muted text-right whitespace-nowrap">
                      {show.isEnded
                        ? 'Avslutad'
                        : show.nextAirDate
                          ? `Nytt avsnitt ${formatSwedishDate(show.nextAirDate)}`
                          : 'Okänt datum'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
