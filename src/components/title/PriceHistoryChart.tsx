'use client';

import { useMemo, useState } from 'react';
import { usePriceHistory } from '@/hooks/usePriceHistory';
import { computePriceStats, priceChartGeometry } from '@/lib/streaming/priceStats';
import JustWatchCredit from '@/components/ui/JustWatchCredit';

// BIN-359 — the full price chart (date x-axis, price y-axis, hover tooltips) over
// the captured priceHistory/{tmdbId} points, the richer visual the parent BIN-354
// ("price-graph") implied. Supersedes the axis-less micro-sparkline: keeps the
// compact Nu / Lägst / Högst stat row for at-a-glance, and draws the real chart
// below it once there are ≥2 points to connect. Renders nothing until ≥1 point.
const WINDOW_DAYS = 180; // "senaste 6 mån"

// Swedish short date for the axis + tooltip ("3 mars"). Module-level so it isn't
// rebuilt per render.
const dateFmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });

export default function PriceHistoryChart({ tmdbId, nowMs }: { tmdbId: number; nowMs: number }) {
  const { data: points } = usePriceHistory(tmdbId);
  const stats = useMemo(() => computePriceStats(points, WINDOW_DAYS, nowMs), [points, nowMs]);
  const geo = useMemo(() => priceChartGeometry(stats?.points ?? null), [stats]);
  const [hover, setHover] = useState<number | null>(null);

  if (!stats) return null;
  const { current, lowest, highest, currency, atLowest, windowed, dropFromHighPct } = stats;
  const lowLabel = windowed ? 'Lägst (6 mån)' : 'Lägst';
  const lowCaption = windowed ? 'Lägsta på 6 mån' : 'Lägsta';
  // The newest dot is the current price — highlight it (saffron = "nu / avgörande").
  const currentIdx = geo ? geo.points.length - 1 : -1;

  return (
    <div className="mt-2 rounded-sm border border-rule-2 bg-surface px-3 py-2">
      {/* Stat row — always shown (works even with a single point). */}
      <div className="flex items-center gap-3">
        <Stat label="Nu" value={`${current} ${currency}`} />
        <span className="h-[26px] w-px bg-rule" />
        <Stat label={lowLabel} value={`${lowest} ${currency}`} accent />
        <span className="h-[26px] w-px bg-rule" />
        <Stat label="Högst" value={`${highest} ${currency}`} />
      </div>

      {/* Full chart — only once there's a trend to draw (≥2 points). */}
      {geo && (
        <div className="relative mt-2">
          <svg
            viewBox={`0 0 ${geo.width} ${geo.height}`}
            width="100%"
            height={geo.height}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Prishistorik: nu ${current} ${currency}, lägst ${lowest}, högst ${highest} ${currency}.`}
            className="block"
          >
            {/* y gridlines + price labels */}
            {geo.priceTicks.map((t, i) => (
              <g key={`y${i}`}>
                <line
                  x1={geo.plotLeft}
                  x2={geo.plotRight}
                  y1={t.cy}
                  y2={t.cy}
                  stroke="var(--rule-2)"
                  strokeWidth="1"
                />
                <text
                  x={geo.plotLeft - 6}
                  y={t.cy + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--ink-3)"
                >
                  {t.amount}
                </text>
              </g>
            ))}

            {/* soft neutral area fill under the line (saffron stays reserved for the
                current-price dot per the two-accent rule — the fill is just depth) */}
            <path d={geo.areaPath} fill="var(--ink-3)" opacity="0.08" stroke="none" />
            {/* the price line */}
            <path d={geo.linePath} fill="none" stroke="var(--ink-2)" strokeWidth="1.5" />

            {/* x-axis date labels */}
            {geo.dateTicks.map((t, i) => (
              <text
                key={`x${i}`}
                x={t.cx}
                y={geo.height - 6}
                textAnchor={i === 0 ? 'start' : i === geo.dateTicks.length - 1 ? 'end' : 'middle'}
                fontSize="10"
                fill="var(--ink-3)"
              >
                {dateFmt.format(t.at)}
              </text>
            ))}

            {/* dots — current one in saffron; generous transparent hit-area for hover */}
            {geo.points.map((p, i) => (
              <g key={`p${i}`}>
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={i === currentIdx ? 3 : 2}
                  fill={i === currentIdx ? 'var(--acc-deep)' : 'var(--ink-2)'}
                />
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r="9"
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                  style={{ cursor: 'pointer' }}
                />
              </g>
            ))}
          </svg>

          {/* hover tooltip — positioned by percent so it tracks any rendered size */}
          {hover != null && geo.points[hover] && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border border-rule bg-bg-2 px-2 py-1 text-[11px] text-ink shadow-pop"
              style={{
                left: `${(geo.points[hover].cx / geo.width) * 100}%`,
                top: `${(geo.points[hover].cy / geo.height) * 100}%`,
                marginTop: -6,
              }}
            >
              <span className="font-bold">
                {geo.points[hover].amount} {geo.points[hover].currency}
              </span>
              <span className="text-ink-3"> · {dateFmt.format(geo.points[hover].at)}</span>
            </div>
          )}
        </div>
      )}

      {/* caption — wires dropFromHighPct into the "lägsta på X mån" line */}
      <div className="mt-[6px] text-[12px] text-ink-3">
        {atLowest ? (
          <span className="text-acc-deep">▼ Lägsta priset hittills sett</span>
        ) : (
          <>
            {lowCaption}: {lowest} {currency}
            {dropFromHighPct > 0 && ` — ${dropFromHighPct}% under högsta`}
          </>
        )}
      </div>

      <JustWatchCredit className="mt-1" />
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
