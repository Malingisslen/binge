'use client';

import { formatKr } from '@/lib/formatKr';
import { formatSwedishDate } from '@/lib/utils';
import type { ServiceCardData, ServiceVerdict } from '@/lib/advisor/verdicts';
import ProviderDot from '@/components/ui/ProviderDot';
import { Button } from '@/components/ui/Button';
import { badgeClass } from '@/components/ui/Badge';
import { cardClass } from '@/components/ui/Card';

interface Props {
  cards: ServiceCardData[];
  onPause: (providerId: number, resumeAt: string) => void;
}

const KEEP_REASON = {
  free: 'Gratis, kostar inget att ha kvar.',
  watching: 'Du har något att titta på här.',
  coming: 'Något du vill se är på väg hit.',
} as const;

function VerdictLine({ verdict }: { verdict: ServiceVerdict }) {
  switch (verdict.kind) {
    case 'keep':
      return (
        <>
          <span className={badgeClass('success')}>Behåll</span>
          <p className="text-xs text-ink-3 mt-1.5">
            {KEEP_REASON[verdict.reason]}
            {verdict.nextAirDate && ` Nytt avsnitt ${formatSwedishDate(verdict.nextAirDate)}.`}
          </p>
        </>
      );
    case 'pause':
      return (
        <>
          <span className={badgeClass('acc')}>Pausa</span>
          <p className="text-xs text-ink-3 mt-1.5">
            {verdict.resumeIsAirDate
              ? `Inget nytt före ${formatSwedishDate(verdict.resumeAt)}. Spar ${formatKr(verdict.monthlyCost)} kr/mån.`
              : `Inget nytt de närmaste 60 dagarna. Spar ${formatKr(verdict.monthlyCost)} kr/mån.`}
          </p>
        </>
      );
    case 'rotate-in':
      return (
        <>
          <span className={badgeClass('muted')}>
            {verdict.alreadyPaused ? 'Pausad' : 'Rotera in'}
          </span>
          {verdict.startDate && (
            <p className="text-xs font-semibold text-cal-deep mt-1.5">
              {verdict.alreadyPaused ? 'Tillbaka' : 'Rotera in'} {formatSwedishDate(verdict.startDate)}
            </p>
          )}
          {!verdict.startDate && <p className="text-xs text-ink-3 mt-1.5">Inget återupptagningsdatum satt.</p>}
        </>
      );
  }
}

export default function ServiceVerdictCards({ cards, onPause }: Props) {
  if (cards.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3.5 list-none p-0">
      {cards.map(c => {
        const v = c.verdict;
        return (
        <li key={c.providerId} className={cardClass('px-3.5 py-3 flex items-start justify-between gap-3')}>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <ProviderDot color={c.color} size={9} />
              <span className="text-base font-semibold text-ink truncate">{c.shortName}</span>
              {c.monthlyCost != null && c.monthlyCost > 0 && (
                <span className="text-xs text-ink-3 whitespace-nowrap">{formatKr(c.monthlyCost)} kr/mån</span>
              )}
            </div>
            <VerdictLine verdict={v} />
          </div>
          {v.kind === 'pause' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="whitespace-nowrap"
              onClick={() => onPause(c.providerId, v.resumeAt)}
            >
              Pausa till {formatSwedishDate(v.resumeAt)}
            </Button>
          )}
        </li>
        );
      })}
    </ul>
  );
}
