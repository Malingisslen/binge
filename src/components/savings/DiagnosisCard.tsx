'use client';

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
    ? <>Du betalar <strong className="text-ink">{cost} kr/mån</strong> för {activeProviderCount} {activeProviderCount === 1 ? 'tjänst' : 'tjänster'}.</>
    : <>Du har {activeProviderCount} {activeProviderCount === 1 ? 'tjänst' : 'tjänster'}.</>;

  let suggestion: React.ReactNode;
  switch (action.kind) {
    case 'pause':
      suggestion = (
        <>
          {' '}
          <strong className="text-ink">{action.providerName}</strong> kan pausas — spar{' '}
          <strong className="text-ink">{action.monthlyCost} kr/mån</strong>.
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
          <strong className="text-ink">{action.monthlyCost} kr/mån</strong>
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
    case 'idle':
    default:
      suggestion = (
        <span className="text-ink-3"> Allt är välbalanserat — vi hör av oss när något ändras.</span>
      );
  }

  return (
    <div className="bg-surface border border-rule border-l-[3px] border-l-acc-deep rounded-sm px-4 py-[14px] mb-[14px]">
      <p className="text-[15px] leading-[1.45] text-ink-2 font-medium">
        {lead}
        {suggestion}
      </p>
    </div>
  );
}
