'use client';

import { formatKr } from '@/lib/formatKr';
import MoneyFigure from '@/components/ui/MoneyFigure';
import type { AdvisorResult } from '@/types';
import { cardClass } from '@/components/ui/Card';

// Streamingrådgivarens "diagnos-mening" — en enda framing-mening som
// förklarar läget och föreslår första steget. Bytte ut den gamla
// standfirsten + delar av primary action card.
//
// Template-driven: en gren per PrimaryAction.kind. Fallback till idle om
// inget annat matchar.

interface Props {
  advisor: AdvisorResult;
  activeProviderCount: number;
}

export default function DiagnosisCard({ advisor, activeProviderCount }: Props) {
  const cost = advisor.totalMonthlyCost;
  const action = advisor.primaryAction;

  // The amount itself is the receipt figure above the sentence (Malin's choice B,
  // plan round 2), so the sentence only counts the services.
  const lead = <>Du har {activeProviderCount} {activeProviderCount === 1 ? 'tjänst' : 'tjänster'}.</>;

  let suggestion: React.ReactNode;
  switch (action.kind) {
    case 'pause':
      suggestion = (
        <>
          {' '}
          <strong className="text-ink">{action.providerName}</strong> kan pausas — spar{' '}
          <strong className="text-ink">{formatKr(action.monthlyCost)} kr/mån</strong>.
        </>
      );
      break;
    case 'catchup':
      suggestion = (
        <>
          {' '}
          <span className="text-ink-3">Du har</span>{' '}
          <strong className="text-ink">
            {action.unfinishedCount} {action.unfinishedCount === 1 ? 'serie' : 'serier'} kvar på {action.providerName}
          </strong>
          .{' '}
          <span className="text-ink-3">Se klart dem, sedan kan du pausa {action.providerName} och spara</span>{' '}
          <strong className="text-ink">{formatKr(action.monthlyCost)} kr/mån</strong>
          <span className="text-ink-3">.</span>
        </>
      );
      break;
    case 'subscribe':
      suggestion = (
        <>
          {' '}
          <strong className="text-ink">
            {action.showCount} {action.showCount === 1 ? 'titel' : 'titlar'} du följer
          </strong>{' '}
          <span className="text-ink-3">har nya avsnitt på</span>{' '}
          <strong className="text-ink">{action.providerName}</strong>
          <span className="text-ink-3"> — som du inte prenumererar på.</span>
        </>
      );
      break;
    case 'needs-library':
      // Beslutad text (förbättringsplan 2, beslut 2) — ändra inte utan Malin.
      suggestion = (
        <>
          {' '}
          <strong className="text-ink">Lägg till det du följer, så kan Binge räkna</strong>
          <span className="text-ink-3">
            {' '}ut vad du kan pausa. Binge behöver minst {action.minTitles} titlar i Följer eller Vill se, du har {action.titleCount}.
          </span>
        </>
      );
      break;
    case 'idle':
    default:
      suggestion = (
        <span className="text-ink-3"> Allt är välbalanserat just nu.</span>
      );
  }

  return (
    <div className={cardClass('border-l-[3px] border-l-acc-deep px-4 py-3.5 mb-3.5')}>
      {cost > 0 && (
        <div className="max-w-[360px] mb-3">
          <MoneyFigure monthlyKr={cost} estimated={advisor.totalMonthlyCostEstimated} />
        </div>
      )}
      <p className="text-lg leading-[1.45] text-ink-2 font-medium">
        {lead}
        {suggestion}
      </p>
    </div>
  );
}
