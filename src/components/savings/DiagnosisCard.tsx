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
    ? <>Du betalar <strong className="text-text-primary">{cost} kr/mån</strong> för {activeProviderCount} {activeProviderCount === 1 ? 'tjänst' : 'tjänster'}.</>
    : <>Du har {activeProviderCount} {activeProviderCount === 1 ? 'tjänst' : 'tjänster'}.</>;

  let suggestion: React.ReactNode;
  switch (action.kind) {
    case 'pause':
      suggestion = (
        <>
          {' '}
          <strong className="text-text-primary">{action.providerName}</strong> kan pausas — spar{' '}
          <strong className="text-text-primary">{action.monthlyCost} kr/mån</strong>.
        </>
      );
      break;
    case 'catchup':
      suggestion = (
        <>
          {' '}
          <span className="text-text-muted">Inget kan pausas just nu — men du ligger efter på</span>{' '}
          <strong className="text-text-primary">
            {action.unfinishedCount} {action.providerName}-{action.unfinishedCount === 1 ? 'serie' : 'serier'}
          </strong>
          .{' '}
          <span className="text-text-muted">Slutför dem så öppnas ett pausfönster värt</span>{' '}
          <strong className="text-text-primary">{action.monthlyCost} kr/mån</strong>
          <span className="text-text-muted">.</span>
        </>
      );
      break;
    case 'subscribe':
      suggestion = (
        <>
          {' '}
          <strong className="text-text-primary">
            {action.showCount} {action.showCount === 1 ? 'titel' : 'titlar'} du följer
          </strong>{' '}
          <span className="text-text-muted">har nya avsnitt på</span>{' '}
          <strong className="text-text-primary">{action.providerName}</strong>
          <span className="text-text-muted"> — som du inte prenumererar på.</span>
        </>
      );
      break;
    case 'idle':
    default:
      suggestion = (
        <span className="text-text-muted"> Allt är välbalanserat — vi hör av oss när något ändras.</span>
      );
  }

  return (
    <div className="bg-surface border border-border-main border-l-[3px] border-l-accent rounded-sm px-4 py-[14px] mb-[14px]">
      <p className="text-[15px] leading-[1.45] text-text-secondary font-medium">
        {lead}
        {suggestion}
      </p>
    </div>
  );
}
