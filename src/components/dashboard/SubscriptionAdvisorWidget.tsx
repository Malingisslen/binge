'use client';

import Link from 'next/link';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import { formatSwedishDate } from '@/lib/utils';

export default function SubscriptionAdvisorWidget() {
  const advisor = useSubscriptionAdvisor();

  if (advisor.isLoading && advisor.providers.length === 0) return null;
  if (advisor.providers.length === 0) return null;

  const pausable = advisor.providers.filter(p => p.status === 'pause');
  const teckna = advisor.subscribeAdvice.slice(0, 2);
  const hasTips = pausable.length > 0 || teckna.length > 0;

  if (!hasTips) return null;

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div className="flex items-center justify-between px-3 py-[6px] border-b border-border-light">
        <span className="text-sm font-bold text-text-secondary">Streamingtips</span>
        <Link href="/savings" className="text-xs text-text-muted no-underline hover:text-accent">
          Detaljer →
        </Link>
      </div>
      <div className="px-3 py-2 space-y-[6px]">
        {pausable.length > 0 && (
          <div className="text-xs text-text-secondary">
            Du kan pausa{' '}
            <span className="font-semibold">
              {pausable.map(p => p.shortName).join(' och ')}
            </span>
            {' — inga serier sänds just nu.'}
            {pausable.length === 1 && pausable[0].monthlyCost
              ? ` Sparar ${pausable[0].monthlyCost} kr/mån.`
              : advisor.monthlySavings > 0
              ? ` Sparar ${advisor.monthlySavings} kr/mån.`
              : ''}
          </div>
        )}
        {teckna.map(sa => (
          <div key={sa.providerId} className="text-xs text-text-secondary">
            Teckna <span className="font-semibold">{sa.shortName}</span>
            {sa.nearestAirDate && ` från ${formatSwedishDate(sa.nearestAirDate)}`}
            {' — '}
            {sa.shows.slice(0, 2).map(s => s.title).join(', ')}
          </div>
        ))}
      </div>
    </div>
  );
}
