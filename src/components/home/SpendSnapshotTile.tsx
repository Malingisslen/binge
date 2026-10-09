'use client';

import Link from 'next/link';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import { computeSpendSnapshot } from '@/lib/spendSnapshot';
import { formatKr } from '@/lib/formatKr';
import { pluralSv } from '@/lib/utils';

// BIN-99 — whole-watchlist spend snapshot. One headline: total monthly streaming
// spend. The total comes from persisted data; the "goes to unused services"
// split comes from the advisor, the same source SparandeTile reads, so the two
// neighbouring cards cannot contradict each other (including below the
// pause-advice floor, where neither names an unused service).

export default function SpendSnapshotTile() {
  const { items } = useWatchlist();
  const { user } = useAuth();
  const advisor = useSubscriptionAdvisor();

  const myProviders = user?.myProviders ?? [];
  if (myProviders.length === 0) return null;

  const snap = computeSpendSnapshot(myProviders, items, user?.providerCosts ?? {}, user?.providerTiers ?? {}, user?.providerCampaigns ?? {});
  if (snap.totalKr <= 0) return null;

  const idle = advisor.isLoading || !advisor.pauseAdviceReady
    ? []
    : advisor.providers.filter(p => p.status === 'pause' && (p.monthlyCost ?? 0) > 0);
  const idleKr = idle.reduce((sum, p) => sum + (p.monthlyCost ?? 0), 0);
  const names = idle.map(p => p.shortName ?? p.providerName).join(', ');

  return (
    <section className="tile" aria-label="Streamingkostnad">
      <div className="h">
        <span>Streamingkostnad</span>
        <Link href="/savings/" className="more">öppna →</Link>
      </div>
      <div className="val tnum">
        {formatKr(snap.totalKr)}{' '}<span className="unit">kr/mån</span>
      </div>
      {idleKr > 0 ? (
        <p className="note">
          varav <strong>{formatKr(idleKr)} kr</strong> går till {pluralSv(idle.length, 'tjänst', 'tjänster')} där
          du inte följer eller vill se något ({names}).
        </p>
      ) : advisor.isLoading ? null : !advisor.pauseAdviceReady ? (
        <p className="note">Lägg till det du följer, så kan Binge se vad du inte använder.</p>
      ) : (
        <p className="note">Allt du betalar för har titlar du följer eller vill se.</p>
      )}
    </section>
  );
}
