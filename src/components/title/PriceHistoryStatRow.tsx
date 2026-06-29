'use client';

import { useMemo } from 'react';
import { usePriceHistory } from '@/hooks/usePriceHistory';
import { computePriceStats, sparklinePoints } from '@/lib/streaming/priceStats';

// BIN-354 (option C — "stat-rad"): a compact Nu / Lägst / Högst row over the
// captured rent-price history, with a micro-sparkline and a drop caption. No
// axis — fastest to scan and works even when history is thin. Renders nothing
// until there's at least one captured price point.
const WINDOW_DAYS = 180; // "senaste 6 mån"

export default function PriceHistoryStatRow({ tmdbId, nowMs }: { tmdbId: number; nowMs: number }) {
  const { data: points } = usePriceHistory(tmdbId);
  const stats = useMemo(
    () => computePriceStats(points, WINDOW_DAYS, nowMs),
    [points, nowMs],
  );
  if (!stats) return null;

  const { current, lowest, highest, currency, atLowest, windowed } = stats;
  // Caption describes the CURRENT price's position (it sits under "Nu"), not the
  // all-time low — so a user reading "▼ N% från högsta" sees what *they'd* pay
  // now vs the peak, not the cheapest-ever discount.
  const currentDropPct = highest > 0 ? Math.round((1 - current / highest) * 100) : 0;
  const spark = sparklinePoints(stats.points);
  // SVG: cheapest (y=0) at the bottom, dearest (y=1) at the top.
  const sparkPath = spark
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * 54 + 1).toFixed(1)},${(2 + (1 - p.y) * 20).toFixed(1)}`)
    .join(' ');
  const lowLabel = windowed ? 'Lägst (6 mån)' : 'Lägst';

  return (
    <div className="mt-2 rounded-sm border border-rule-2 bg-surface px-3 py-2">
      <div className="flex items-center gap-3">
        <Stat label="Nu" value={`${current} ${currency}`} />
        <span className="h-[26px] w-px bg-rule" />
        <Stat label={lowLabel} value={`${lowest} ${currency}`} accent />
        <span className="h-[26px] w-px bg-rule" />
        <Stat label="Högst" value={`${highest} ${currency}`} />
        {sparkPath && (
          <svg viewBox="0 0 56 24" preserveAspectRatio="none" aria-hidden="true" className="ml-auto h-6 w-14 shrink-0">
            <path d={sparkPath} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" />
          </svg>
        )}
      </div>
      {(currentDropPct > 0 || atLowest) && (
        <div className="mt-[6px] text-[12px] text-ink-3">
          {atLowest ? 'Lägsta priset hittills sett' : `▼ ${currentDropPct}% från högsta`}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10.5px] uppercase tracking-[0.04em] text-ink-3">{label}</span>
      <span className={`text-[17px] font-bold ${accent ? 'text-acc-deep' : 'text-ink'}`}>{value}</span>
    </div>
  );
}
