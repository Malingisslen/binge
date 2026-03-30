'use client';

import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import type { ProviderAdvisory } from '@/types';

function formatNextDate(dateStr: string | null): string {
  if (!dateStr) return 'Inget kommande';
  const today = new Date().toISOString().split('T')[0];
  if (dateStr === today) return 'idag';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

function StatusLabel({ status }: { status: ProviderAdvisory['status'] }) {
  if (status === 'active') return <span className="text-accent text-xs">Aktiv</span>;
  if (status === 'upcoming') return <span className="text-text-secondary text-xs">Snart</span>;
  return <span className="text-text-muted text-xs">Pausa</span>;
}

export default function SubscriptionAdvisorWidget() {
  const { user } = useAuth();
  const advisor = useSubscriptionAdvisor();

  if (!user) return null;

  const myProviders = user.myProviders ?? [];
  if (myProviders.length === 0) return null;

  if (advisor.isLoading && advisor.providers.length === 0) {
    return (
      <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
        <div className="px-3 py-[6px] border-b border-border-light">
          <span className="text-sm font-bold text-text-secondary">Streamingrådgivare</span>
        </div>
        <div className="px-3 py-2 text-xs text-text-muted">Laddar...</div>
      </div>
    );
  }

  if (advisor.providers.length === 0) return null;

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div className="flex items-center justify-between px-3 py-[6px] border-b border-border-light">
        <span className="text-sm font-bold text-text-secondary">Streamingrådgivare</span>
        {advisor.monthlySavings > 0 ? (
          <Link href="/savings" className="text-xs text-accent no-underline">
            Spara {advisor.monthlySavings} kr/mån &rarr;
          </Link>
        ) : (
          <Link href="/savings" className="text-xs text-text-muted no-underline">
            Detaljer &rarr;
          </Link>
        )}
      </div>
      <div className="px-3 py-1">
        {advisor.providers.map(p => (
          <div key={p.providerId} className="flex items-center gap-2 py-[3px]">
            <span
              className="w-[6px] h-[6px] rounded-full shrink-0"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-xs text-text-primary w-[80px] truncate">{p.shortName}</span>
            <span className="w-[36px]"><StatusLabel status={p.status} /></span>
            <span className="text-xs text-text-muted flex-1">
              {p.shows.length} {p.shows.length === 1 ? 'serie' : 'serier'}
            </span>
            <span className="text-xs text-text-muted text-right">
              {p.status !== 'pause' ? `Nästa: ${formatNextDate(p.nextAirDate)}` : ''}
              {p.status === 'pause' && p.monthlyCost ? `${p.monthlyCost} kr/mån` : ''}
            </span>
          </div>
        ))}
        {advisor.subscribeAdvice.length > 0 && (
          <div className="border-t border-border-light mt-1 pt-1">
            {advisor.subscribeAdvice.slice(0, 2).map(sa => (
              <div key={sa.providerId} className="text-xs text-text-muted py-[2px]">
                <span className="text-text-secondary">Teckna {sa.shortName}</span>
                {' \u2014 '}
                {sa.shows[0].title}
                {sa.nearestAirDate && ` startar ${formatNextDate(sa.nearestAirDate)}`}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
