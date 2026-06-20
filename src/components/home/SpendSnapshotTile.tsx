'use client';

import Link from 'next/link';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { computeSpendSnapshot } from '@/lib/spendSnapshot';
import { pluralSv } from '@/lib/utils';

// BIN-99 — whole-watchlist spend snapshot. One headline: total monthly streaming
// spend split into active vs idle. Computed from persisted data (no advisor
// fan-out), unlike SparandeTile which reasons about pausable services.

export default function SpendSnapshotTile() {
  const { items } = useWatchlist();
  const { user } = useAuth();

  const myProviders = user?.myProviders ?? [];
  if (myProviders.length === 0) return null;

  const snap = computeSpendSnapshot(myProviders, items, user?.providerCosts ?? {});
  if (snap.totalKr <= 0) return null;

  return (
    <section className="tile" aria-label="Streamingkostnad">
      <div className="h">
        <span>Streamingkostnad</span>
        <Link href="/savings/" className="more">öppna →</Link>
      </div>
      <div className="val tnum">
        {snap.totalKr}<span className="unit">kr/mån</span>
      </div>
      {snap.idleKr > 0 ? (
        <p className="note">
          {/* idleKr > 0 ⇒ at least one idle provider, so the names always render. */}
          varav <strong>{snap.idleKr} kr</strong> går till {pluralSv(snap.idleProviders.length, 'tjänst', 'tjänster')} utan
          aktiv backlog ({snap.idleProviders.map(p => p.name).join(', ')}).
        </p>
      ) : (
        <p className="note">Allt du betalar för har titlar du vill se.</p>
      )}
    </section>
  );
}
