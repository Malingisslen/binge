'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import { posterUrl } from '@/lib/tmdb/client';
import type { ProviderAdvisory, AdvisedShow } from '@/types';

export default function SavingsPage() {
  return <AuthGuard><SavingsContent /></AuthGuard>;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Okänt datum';
  const today = new Date().toISOString().split('T')[0];
  if (dateStr === today) return 'idag';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: undefined });
}

function StatusBadge({ status }: { status: ProviderAdvisory['status'] }) {
  if (status === 'active') return <span className="text-accent text-xs font-semibold">Aktiv</span>;
  if (status === 'upcoming') return <span className="text-text-secondary text-xs font-semibold">Snart</span>;
  return <span className="text-red-500/80 text-xs font-semibold">Pausa</span>;
}

function ShowRow({ show }: { show: AdvisedShow }) {
  const href = `/tv/${show.tmdbId}`;
  return (
    <Link href={href} className="flex items-center gap-2 py-[3px] no-underline group">
      {show.posterPath ? (
        <img
          src={posterUrl(show.posterPath, 'w92') ?? undefined}
          alt=""
          className="w-[22px] h-[33px] object-cover rounded-[1px] shrink-0"
        />
      ) : (
        <div className="w-[22px] h-[33px] bg-border-main rounded-[1px] shrink-0" />
      )}
      <span className="text-xs text-text-primary group-hover:text-accent flex-1 truncate">{show.title}</span>
      <span className="text-xs text-text-muted shrink-0">
        {show.isEnded
          ? 'Avslutad'
          : show.nextAirDate
            ? `${show.nextEpisodeCode ?? ''} ${formatDate(show.nextAirDate)}`
            : 'Okänt datum'}
      </span>
    </Link>
  );
}

function ProviderSection({ advisory }: { advisory: ProviderAdvisory }) {
  const [expanded, setExpanded] = useState(advisory.status !== 'pause' || advisory.shows.length > 0);

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[10px]">
      <div
        className="flex items-center gap-2 px-3 py-[6px] border-b border-border-light cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs text-text-muted">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span
          className="w-[7px] h-[7px] rounded-full shrink-0"
          style={{ backgroundColor: advisory.color }}
        />
        <span className="text-sm font-bold text-text-secondary flex-1">{advisory.providerName}</span>
        <StatusBadge status={advisory.status} />
        {advisory.monthlyCost != null && (
          <span className="text-xs text-text-muted">{advisory.monthlyCost} kr/mån</span>
        )}
        <span className="text-xs text-text-muted">
          {advisory.shows.length} {advisory.shows.length === 1 ? 'serie' : 'serier'}
        </span>
      </div>
      {expanded && (
        <div className="px-3 py-1">
          {advisory.shows.length === 0 ? (
            <div className="text-xs text-text-muted py-1">
              Du följer inga serier på {advisory.shortName}.
              {advisory.monthlyCost != null && ` Spara ${advisory.monthlyCost} kr/mån.`}
            </div>
          ) : (
            <>
              {advisory.shows.map(show => (
                <ShowRow key={show.tmdbId} show={show} />
              ))}
              {advisory.status === 'pause' && advisory.monthlyCost != null && (
                <div className="text-xs text-text-muted py-1 border-t border-border-light mt-1">
                  Inga kommande avsnitt inom perioden. Spara {advisory.monthlyCost} kr/mån.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SavingsContent() {
  const [lookAhead, setLookAhead] = useState(60);
  const advisor = useSubscriptionAdvisor(lookAhead);

  if (advisor.isLoading && advisor.providers.length === 0) {
    return (
      <div>
        <h1 className="text-md font-bold text-text-primary mb-3">Streamingrådgivare</h1>
        <p className="text-sm text-text-muted">Laddar...</p>
      </div>
    );
  }

  if (advisor.providers.length === 0) {
    return (
      <div>
        <h1 className="text-md font-bold text-text-primary mb-3">Streamingrådgivare</h1>
        <p className="text-sm text-text-muted">
          <Link href="/settings" className="text-accent no-underline">Lägg till tjänster i inställningar</Link> för att se rådgivning.
        </p>
      </div>
    );
  }

  const activeCount = advisor.providers.filter(p => p.status === 'active' || p.status === 'upcoming').length;
  const pauseCount = advisor.providers.filter(p => p.status === 'pause').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-md font-bold text-text-primary">Streamingrådgivare</h1>
        <div className="flex gap-[1px]">
          {([30, 60, 90] as const).map(days => (
            <span
              key={days}
              onClick={() => setLookAhead(days)}
              className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
                lookAhead === days ? 'bg-accent text-white' : 'text-text-muted'
              }`}
            >
              {days} dagar
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-4">
        <div className="bg-surface border border-border-main rounded-sm px-3 py-2 text-center">
          <div className="text-[20px] font-bold text-accent">
            {advisor.totalMonthlyCost > 0 ? `${advisor.totalMonthlyCost}` : '\u2014'}
          </div>
          <div className="text-xxs text-text-muted uppercase tracking-[0.5px]">Total kr/mån</div>
        </div>
        <div className="bg-surface border border-border-main rounded-sm px-3 py-2 text-center">
          <div className="text-[20px] font-bold text-accent">
            {advisor.monthlySavings > 0 ? `${advisor.monthlySavings}` : '\u2014'}
          </div>
          <div className="text-xxs text-text-muted uppercase tracking-[0.5px]">Besparing/mån</div>
        </div>
        <div className="bg-surface border border-border-main rounded-sm px-3 py-2 text-center">
          <div className="text-[20px] font-bold text-accent">{activeCount}</div>
          <div className="text-xxs text-text-muted uppercase tracking-[0.5px]">Aktiva</div>
        </div>
        <div className="bg-surface border border-border-main rounded-sm px-3 py-2 text-center">
          <div className="text-[20px] font-bold text-accent">{pauseCount}</div>
          <div className="text-xxs text-text-muted uppercase tracking-[0.5px]">Pausa</div>
        </div>
      </div>

      <h2 className="text-sm font-bold text-text-secondary mb-2">Dina tjänster</h2>
      {advisor.providers.map(p => (
        <ProviderSection key={p.providerId} advisory={p} />
      ))}

      {advisor.subscribeAdvice.length > 0 && (
        <>
          <h2 className="text-sm font-bold text-text-secondary mb-2 mt-4">Teckna</h2>
          {advisor.subscribeAdvice.map(sa => (
            <div key={sa.providerId} className="bg-surface border border-border-main rounded-sm mb-[10px]">
              <div className="flex items-center gap-2 px-3 py-[6px] border-b border-border-light">
                <span
                  className="w-[7px] h-[7px] rounded-full shrink-0"
                  style={{ backgroundColor: sa.color }}
                />
                <span className="text-sm font-bold text-text-secondary flex-1">{sa.providerName}</span>
                <span className="text-xs text-text-muted">
                  {sa.shows.length} {sa.shows.length === 1 ? 'serie' : 'serier'}
                </span>
              </div>
              <div className="px-3 py-1">
                {sa.shows.map(show => (
                  <ShowRow key={show.tmdbId} show={show} />
                ))}
                {sa.nearestAirDate && (
                  <div className="text-xs text-text-muted py-1 border-t border-border-light mt-1">
                    Teckna {sa.shortName} från ~{formatDate(sa.nearestAirDate)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
