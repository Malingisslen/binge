'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import ProviderDot from '@/components/ui/ProviderDot';
import StatCard from '@/components/ui/StatCard';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import { posterUrl } from '@/lib/tmdb/client';
import { formatSwedishDate, pluralSv } from '@/lib/utils';
import type { ProviderAdvisory, AdvisedShow } from '@/types';

export default function SavingsPage() {
  return <AuthGuard><SavingsContent /></AuthGuard>;
}

function StatusBadge({ status }: { status: ProviderAdvisory['status'] }) {
  if (status === 'active') return <span className="text-accent text-xs font-semibold">Aktiv</span>;
  if (status === 'upcoming') return <span className="text-text-secondary text-xs font-semibold">Snart</span>;
  return <span className="text-text-muted text-xs font-semibold">Pausa</span>;
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
            ? `${show.nextEpisodeCode ?? ''} ${formatSwedishDate(show.nextAirDate)}`
            : 'Okänt datum'}
      </span>
    </Link>
  );
}

function ProviderSection({ advisory }: { advisory: ProviderAdvisory }) {
  const [expanded, setExpanded] = useState(advisory.status !== 'pause');

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[10px]">
      <div
        className="flex items-center gap-2 px-3 py-[6px] border-b border-border-light cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs text-text-muted">{expanded ? '\u25BC' : '\u25B6'}</span>
        <ProviderDot color={advisory.color} size={7} />
        <span className="text-sm font-bold text-text-secondary flex-1">{advisory.providerName}</span>
        <StatusBadge status={advisory.status} />
        {advisory.monthlyCost != null && (
          <span className="text-xs text-text-muted">{advisory.monthlyCost} kr/mån</span>
        )}
        <span className="text-xs text-text-muted">
          {pluralSv(advisory.shows.length, 'serie', 'serier')}
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

  const activeCount = advisor.providers.filter(p => p.status === 'active' || p.status === 'upcoming').length;
  const pauseCount = advisor.providers.filter(p => p.status === 'pause').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-[18px] font-bold text-text-primary">Streamingrådgivare</h1>
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
        <StatCard label="Total kr/mån" value={advisor.totalMonthlyCost > 0 ? `${advisor.totalMonthlyCost} kr` : 'Ange i inst.'} />
        <StatCard label="Besparing/mån" value={advisor.monthlySavings > 0 ? `${advisor.monthlySavings} kr` : 'Ange i inst.'} />
        <StatCard label="Aktiva" value={activeCount} />
        <StatCard label="Pausa" value={pauseCount} />
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
                <ProviderDot color={sa.color} size={7} />
                <span className="text-sm font-bold text-text-secondary flex-1">{sa.providerName}</span>
                <span className="text-xs text-text-muted">
                  {pluralSv(sa.shows.length, 'serie', 'serier')}
                </span>
              </div>
              <div className="px-3 py-1">
                {sa.shows.map(show => (
                  <ShowRow key={show.tmdbId} show={show} />
                ))}
                {sa.nearestAirDate && (
                  <div className="text-xs text-text-muted py-1 border-t border-border-light mt-1">
                    Teckna {sa.shortName} från ~{formatSwedishDate(sa.nearestAirDate)}
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
