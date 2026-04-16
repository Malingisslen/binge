'use client';

import Link from 'next/link';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';

export default function SubscriptionAdvisorWidget() {
  const advisor = useSubscriptionAdvisor();

  if (advisor.isLoading && advisor.providers.length === 0) return null;
  if (advisor.providers.length === 0) return null;

  const pausable = advisor.providers.filter(p => p.status === 'pause');
  const teckna = advisor.subscribeAdvice.slice(0, 1);
  const hasTips = pausable.length > 0 || teckna.length > 0;

  if (!hasTips) return null;

  const message = (() => {
    if (pausable.length > 0) {
      const names = pausable.map(p => p.shortName).join(' och ');
      const savings = advisor.monthlySavings > 0 ? ` Sparar ${advisor.monthlySavings} kr/mån.` : '';
      return (
        <span>
          Du kan pausa <b>{names}</b> — inga serier sänds just nu.{savings}
        </span>
      );
    }
    if (teckna.length > 0) {
      const sa = teckna[0];
      return (
        <span>
          Teckna <b>{sa.shortName}</b> för {sa.shows.slice(0, 2).map(s => s.title).join(', ')}
        </span>
      );
    }
    return null;
  })();

  return (
    <div className="bg-accent/[0.04] border border-accent/60 rounded-sm mb-[14px] px-3 py-[6px] flex items-center justify-between gap-2">
      <span className="text-xs text-text-secondary">{message}</span>
      <Link href="/savings" className="text-xs text-accent no-underline shrink-0">
        Mer →
      </Link>
    </div>
  );
}
