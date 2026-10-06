'use client';

import { formatKr } from '@/lib/formatKr';
import type { AdvisorResult } from '@/types';

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

  const lead = cost > 0
    ? <>
        Du betalar <strong className="text-ink">{formatKr(cost)} kr/mån</strong>
        {/* Paket I: listpriset är katalogens, inte användarens — säg det där siffran står. */}
        {advisor.totalMonthlyCostEstimated && <span className="text-ink-3"> (uppskattat)</span>}
        {' '}för {activeProviderCount} {activeProviderCount === 1 ? 'tjänst' : 'tjänster'}.
      </>
    : <>Du har {activeProviderCount} {activeProviderCount === 1 ? 'tjänst' : 'tjänster'}.</>;

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
          <span className="text-ink-3">Inget kan pausas just nu — men du ligger efter på</span>{' '}
          <strong className="text-ink">
            {action.unfinishedCount} {action.providerName}-{action.unfinishedCount === 1 ? 'serie' : 'serier'}
          </strong>
          .{' '}
          <span className="text-ink-3">Slutför dem så öppnas ett pausfönster värt</span>{' '}
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
    <div className="bg-surface border border-rule border-l-[3px] border-l-acc-deep rounded-sm px-4 py-[14px] mb-[14px]">
      <p className="text-lg leading-[1.45] text-ink-2 font-medium">
        {lead}
        {suggestion}
      </p>
    </div>
  );
}
