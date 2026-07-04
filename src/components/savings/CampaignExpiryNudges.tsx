'use client';

import { useMemo } from 'react';
import ProviderDot from '@/components/ui/ProviderDot';
import { useAuth } from '@/hooks/useAuth';
import { computeCampaignNudges } from '@/lib/advisor/campaignNudges';
import { pluralSv } from '@/lib/utils';

// BIN-417 Phase B — "din kampanj löper ut snart" money nudge on the advisor
// surface. Same character as the advisor's other nudges: a subtle surface card
// with an acc-deep accent stripe (not a loud fill). Silent unless a campaign is
// active, ending within 7 days, and the price genuinely rises ≥1 kr.
export default function CampaignExpiryNudges() {
  const { user } = useAuth();
  const now = useMemo(() => new Date(), []);
  const rows = useMemo(
    () =>
      computeCampaignNudges(
        user?.providerCampaigns,
        { providerTiers: user?.providerTiers, providerCosts: user?.providerCosts },
        now,
      ),
    [user?.providerCampaigns, user?.providerTiers, user?.providerCosts, now],
  );

  if (rows.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {rows.map(r => (
        <div
          key={r.providerId}
          className="flex items-center gap-2 bg-surface border border-rule border-l-[3px] border-l-acc-deep rounded-sm px-3 py-2 text-xs"
        >
          <ProviderDot color={r.color} size={7} />
          <span className="text-ink">
            <span className="font-semibold">{r.providerName}</span>-kampanjen löper ut{' '}
            {r.nudge.daysUntilEnd === 0 ? 'idag' : `om ${pluralSv(r.nudge.daysUntilEnd, 'dag', 'dagar')}`} — sedan{' '}
            <span className="tabular-nums">{r.nudge.ordinaryMonthlyCost} kr/mån</span>{' '}
            <span className="text-ink-3">(+{r.nudge.increaseKr} kr)</span>.
          </span>
        </div>
      ))}
    </div>
  );
}
