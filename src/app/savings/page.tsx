'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import ProviderDot from '@/components/ui/ProviderDot';
import SrOnlyTableHeader from '@/components/ui/SrOnlyTableHeader';
import AdvisorTimeline from '@/components/savings/AdvisorTimeline';
import WillSeePerProvider from '@/components/savings/WillSeePerProvider';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { titleHref } from '@/lib/tmdb/client';
import { formatSwedishDate, addDaysFromToday, todayIso, pluralSv } from '@/lib/utils';
import type { AdvisedShow, PrimaryAction, ActivePause, SubscribeAdvisory } from '@/types';

const LOOK_AHEAD_DAYS = 60;

export default function SavingsPage() {
  return <AuthGuard><SavingsContent /></AuthGuard>;
}

function PauseActionCard({ action, onPause }: { action: Extract<PrimaryAction, { kind: 'pause' }>; onPause: (id: number, resumeAt: string | null) => void }) {
  const defaultResumeAt = action.nextAirDate ?? addDaysFromToday(30);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [resumeAt, setResumeAt] = useState<string>(defaultResumeAt);
  const until = action.nextAirDate ? `tills ${formatSwedishDate(action.nextAirDate)}` : `i ${LOOK_AHEAD_DAYS} dagar framåt`;
  const quickPauseLabel = action.nextAirDate
    ? `Pausa till ${formatSwedishDate(action.nextAirDate)}`
    : 'Pausa i 30 dagar';

  return (
    <div className="bg-surface border border-border-main border-l-[3px] border-l-season-done rounded-sm p-4 mb-[14px]">
      <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-season-done mb-1">Spar nu</div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-base font-bold text-text-primary">
            Pausa {action.providerName} — spar {action.monthlyCost} kr/mån
          </div>
          <div className="text-xs text-text-muted mt-[2px]">
            Inget från din Följer eller Vill se ligger här {until}.
          </div>
        </div>
        {!pauseOpen && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onPause(action.providerId, defaultResumeAt)}
              className="px-3 py-[6px] bg-season-done text-white border-none rounded-sm text-xs font-semibold font-[inherit] cursor-pointer"
            >
              {quickPauseLabel}
            </button>
            <button
              onClick={() => setPauseOpen(true)}
              className="text-xxs text-text-muted bg-transparent border-none cursor-pointer font-[inherit] hover:text-text-primary"
            >
              Annan period…
            </button>
          </div>
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
              className="px-3 py-[5px] bg-season-done text-white border-none rounded-sm text-xs font-semibold font-[inherit] cursor-pointer"
            >
              Bekräfta paus
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const ACTION_BUTTON_CLASS = 'px-3 py-[6px] bg-accent text-white no-underline rounded-sm text-xs font-semibold font-[inherit] cursor-pointer shrink-0';

function SecondaryActionCard({
  label,
  title,
  description,
  action,
}: {
  label: string;
  title: React.ReactNode;
  description: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-border-main border-l-[3px] border-l-accent rounded-sm p-4 mb-[14px]">
      <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-accent mb-1">{label}</div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-base font-bold text-text-primary">{title}</div>
          <div className="text-xs text-text-muted mt-[2px]">{description}</div>
        </div>
        {action}
      </div>
    </div>
  );
}

function PrimaryActionCard({
  action,
  onPause,
  onShowSubscribeRows,
}: {
  action: PrimaryAction;
  onPause: (id: number, resumeAt: string | null) => void;
  onShowSubscribeRows: () => void;
}) {
  if (action.kind === 'pause') {
    return <PauseActionCard action={action} onPause={onPause} />;
  }

  if (action.kind === 'catchup') {
    return (
      <SecondaryActionCard
        label="Slutför"
        title={`Titta klart på ${action.providerName}`}
        description={`Du ligger efter på ${action.unfinishedCount} ${action.unfinishedCount === 1 ? 'serie' : 'serier'} här. Avsluta dem innan nästa pausningsfönster för att slippa betala för ett abonnemang du inte utnyttjar.`}
        action={
          <Link href={`/my/series?provider=${action.providerId}&status=behind`} className={ACTION_BUTTON_CLASS}>
            Visa {action.shortName}-serier ({action.unfinishedCount})
          </Link>
        }
      />
    );
  }

  if (action.kind === 'subscribe') {
    return (
      <SecondaryActionCard
        label="Lägg till"
        title={`Prenumerera på ${action.providerName}`}
        description={
          <>
            {pluralSv(action.showCount, 'serie du följer', 'serier du följer')} har nya avsnitt inom {LOOK_AHEAD_DAYS} dagar
            {action.nearestAirDate ? `, nästa ${formatSwedishDate(action.nearestAirDate)}` : ''}
            {action.monthlyCost > 0 ? ` · ${action.monthlyCost} kr/mån` : ''}.
          </>
        }
        action={
          <button onClick={onShowSubscribeRows} className={`${ACTION_BUTTON_CLASS} border-none`}>
            Visa titlar ({action.showCount})
          </button>
        }
      />
    );
  }

  // idle
  return (
    <div className="bg-surface border border-border-main rounded-sm p-4 mb-[14px]">
      <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-text-muted mb-1">Allt är välbalanserat</div>
      <div className="text-base font-bold text-text-primary">Inget att agera på just nu</div>
      <div className="text-xs text-text-muted mt-[2px]">
        {action.nextCheckDate
          ? `Nästa översyn kring ${formatSwedishDate(action.nextCheckDate)} när något förändras.`
          : 'Vi hör av oss när något förändras i din följ-lista.'}
      </div>
    </div>
  );
}

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
  const { getByStatus } = useWatchlist();
  const followedTvCount = getByStatus('mina', 'tv').filter(i => !i.dropped).length;
  const subscribeDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const handleShowSubscribeRows = () => {
    const el = subscribeDetailsRef.current;
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (advisor.isLoading && advisor.providers.length === 0) {
    return (
      <>
        <header>
          <div className="crumb">Sparande</div>
          <h1 className="page-h1">Streamingrådgivare</h1>
          <p className="stand">Laddar din analys…</p>
        </header>
      </>
    );
  }

  if (advisor.providers.length === 0) {
    return (
      <>
        <header>
          <div className="crumb">Sparande</div>
          <h1 className="page-h1">Streamingrådgivare</h1>
          <p className="stand">
            Lägg till tjänster i <Link href="/settings/" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--rule)' }}>inställningar</Link> för
            att få rådgivning om vad du kan pausa och spara på.
          </p>
        </header>
      </>
    );
  }

  const activeProviders = advisor.providers.filter(p => p.status !== 'pause');
  const pauseProviders = advisor.providers.filter(p => p.status === 'pause');
  const userPausedSet = new Set(advisor.activePauses.map(p => p.providerId));
  const suggestedPauseCount = pauseProviders.filter(p => !userPausedSet.has(p.providerId)).length;

  const allSubscribeRows = advisor.subscribeAdvice
    .flatMap(sa => sa.shows.map(show => ({ show, provider: sa })))
    .sort((a, b) => {
      const ad = a.show.nextAirDate ?? '\uffff';
      const bd = b.show.nextAirDate ?? '\uffff';
      return ad.localeCompare(bd);
    });
  const subscribeRows = allSubscribeRows.filter(r => hasConcreteStatus(r.show));
  const datelessSubscribeRows = allSubscribeRows.filter(r => !hasConcreteStatus(r.show));

  return (
    <>
      <header>
        <div className="crumb">Sparande · {activeProviders.length + pauseProviders.length} tjänster</div>
        <h1 className="page-h1">Streamingrådgivare</h1>
        <p className="stand">
          {suggestedPauseCount > 0
            ? `${suggestedPauseCount} ${suggestedPauseCount === 1 ? 'tjänst kan pausas' : 'tjänster kan pausas'} just nu — du tittar inget aktivt på dem.`
            : 'Alla dina tjänster används aktivt. Inget att pausa just nu.'}
        </p>
      </header>
      <div style={{ marginTop: 28 }}>

      <PrimaryActionCard
        action={advisor.primaryAction}
        onPause={(id, resumeAt) => pauseProvider(id, resumeAt)}
        onShowSubscribeRows={handleShowSubscribeRows}
      />

      {advisor.secondaryAction && (
        <PrimaryActionCard
          action={advisor.secondaryAction}
          onPause={(id, resumeAt) => pauseProvider(id, resumeAt)}
          onShowSubscribeRows={handleShowSubscribeRows}
        />
      )}

      <ActivePausesSection
        pauses={advisor.activePauses}
        onResume={(id) => resumeProvider(id)}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[10px] mb-4">
        <div className="bg-surface border border-border-main rounded-sm px-3 py-[10px]">
          <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-text-muted">Kostnad/mån</div>
          <div className="text-base font-bold text-text-primary mt-[2px]">
            {advisor.totalMonthlyCost > 0 ? `${advisor.totalMonthlyCost} kr` : <Link href="/settings" className="text-accent no-underline text-xs">Ange →</Link>}
          </div>
          {advisor.totalMonthlyCost > 0 && followedTvCount > 0 && (
            <div
              className="text-xxs text-text-muted mt-[2px]"
              title="Genomsnitt: total månadskostnad delat med antal serier i din Följer-lista"
            >
              {Math.round(advisor.totalMonthlyCost / followedTvCount)} kr per följd serie
            </div>
          )}
        </div>
        <div className="bg-surface border border-border-main rounded-sm px-3 py-[10px]">
          <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-text-muted">Kan pausas</div>
          {suggestedPauseCount > 0 ? (
            <>
              <div className="text-base font-bold text-season-done mt-[2px]">
                {pluralSv(suggestedPauseCount, 'tjänst', 'tjänster')}
              </div>
              {advisor.monthlySavings > 0 && (
                <div className="text-xxs text-season-done mt-[2px]">
                  Spar {advisor.monthlySavings} kr/mån
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-base font-bold text-text-primary mt-[2px]">Inget just nu</div>
              <div className="text-xxs text-text-muted mt-[2px]">
                {activeProviders.length > 0
                  ? `Alla ${pluralSv(activeProviders.length, 'tjänst', 'tjänster')} används`
                  : 'Inga aktiva tjänster'}
              </div>
            </>
          )}
        </div>
        <div className="bg-surface border border-border-main rounded-sm px-3 py-[10px]">
          <div className="text-xxs uppercase tracking-[0.5px] font-semibold text-text-muted">Mest använd</div>
          {advisor.mostUsedProvider ? (
            <>
              <div className="text-base font-bold text-text-primary mt-[2px] flex items-center gap-[6px]">
                <ProviderDot color={advisor.mostUsedProvider.color} size={8} />
                {advisor.mostUsedProvider.shortName}
              </div>
              <div className="text-xxs text-text-muted mt-[2px]">
                {[
                  advisor.mostUsedProvider.followCount > 0 && `${advisor.mostUsedProvider.followCount} följer`,
                  advisor.mostUsedProvider.willSeeCount > 0 && `${advisor.mostUsedProvider.willSeeCount} vill se`,
                ].filter(Boolean).join(' · ')}
              </div>
            </>
          ) : (
            <>
              <div className="text-base font-bold text-text-primary mt-[2px]">—</div>
              <div className="text-xxs text-text-muted mt-[2px]">Inga titlar i Följer eller Vill se</div>
            </>
          )}
        </div>
      </div>

      <AdvisorTimeline />

      <WillSeePerProvider rows={advisor.willSeeByProvider} />

      {(subscribeRows.length > 0 || datelessSubscribeRows.length > 0) && (
        <details ref={subscribeDetailsRef} className="mb-3 scroll-mt-3">
          <summary className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted cursor-pointer select-none list-none">
            Titlar på tjänster du inte har ({subscribeRows.length + datelessSubscribeRows.length}) ›
          </summary>
          <p className="text-xxs text-text-muted mt-1 mb-2">Titlar från din Följer och Vill se som ligger på en tjänst du inte har.</p>
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
        </details>
      )}
      </div>
    </>
  );
}
