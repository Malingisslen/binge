// BIN-354 — pure stats over a title's captured rent-price history.
//
// The points come from priceHistory/{tmdbId}.points (BIN-180), appended
// write-on-change by the streamingOffersRefresh cron, so they're sparse. This
// helper turns them into the "Nu / Lägst / Högst" stat row (option C) the title
// page renders. Pure (no Firebase) so it's unit-testable.

export interface PricePoint {
  at: number;       // epoch ms (capture time)
  amount: number;   // cheapest rent price at that time
  currency: string;
}

export interface PriceStats {
  current: number;   // most recent captured price
  lowest: number;    // lowest within the window (or all-time fallback)
  highest: number;   // highest within the window (or all-time fallback)
  currency: string;
  /** % the window LOW sits below the window high (0 when flat). Wired into the
   *  "lägsta på 6 mån — N% under högsta" caption (BIN-359). */
  dropFromHighPct: number;
  /** Whether the current price equals the window low (a "lowest seen" moment). */
  atLowest: boolean;
  /** True when ≥1 point fell inside the window (so a "senaste N mån"-label is honest). */
  windowed: boolean;
  /** Points used for the sparkline (windowed, or all when the window is empty). */
  points: PricePoint[];
}

const DAY_MS = 86_400_000;

/**
 * Reduce sparse price points to the stat row. Returns null when there's no data
 * to show. `windowDays` scopes lowest/highest (e.g. 180 = "senaste 6 mån"); if
 * no points fall inside the window we fall back to ALL points so the row is
 * still meaningful (and the caller can label it accordingly). `current` is
 * always the most recent point overall.
 */
export function computePriceStats(
  points: PricePoint[] | undefined | null,
  windowDays: number,
  nowMs: number,
): PriceStats | null {
  if (!points || points.length === 0) return null;
  const cutoff = nowMs - windowDays * DAY_MS;
  const windowed = points.filter(p => p.at >= cutoff);
  const used = windowed.length > 0 ? windowed : points;

  const last = points[points.length - 1];
  const current = last.amount;
  const currency = last.currency;
  const amounts = used.map(p => p.amount);
  const lowest = Math.min(...amounts);
  const highest = Math.max(...amounts);
  const dropFromHighPct = highest > 0 ? Math.round((1 - lowest / highest) * 100) : 0;

  return {
    current,
    lowest,
    highest,
    currency,
    dropFromHighPct,
    atLowest: current === lowest,
    windowed: windowed.length > 0,
    points: used,
  };
}

/**
 * Build a normalized 0..1 polyline (oldest→newest) for a sparkline. Returns an
 * array of {x, y} in [0,1] where y=0 is the cheapest and y=1 the most expensive,
 * so the consumer can map to any viewBox. Returns [] for <2 points (nothing to
 * draw a line between).
 */
export function sparklinePoints(points: PricePoint[]): { x: number; y: number }[] {
  if (points.length < 2) return [];
  const amounts = points.map(p => p.amount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const span = max - min;
  const n = points.length - 1;
  return points.map((p, i) => ({
    x: i / n,
    y: span === 0 ? 0.5 : (p.amount - min) / span,
  }));
}

// BIN-359 — geometry for the FULL price chart (axes + hover), the richer visual
// the parent BIN-354 ("price-graph") implied. Kept pure + DOM-free (no Intl, no
// React): returns pixel coordinates + the RAW values, and the component formats
// the labels (Swedish date, "kr"). Same split as sparklinePoints — geometry is
// math, rendering is the component's job — so this stays unit-testable.

export interface ChartPixelPoint {
  cx: number;      // px within the viewBox
  cy: number;      // px (inverted: dearer = higher = smaller cy)
  at: number;      // raw epoch ms (component formats the tooltip date)
  amount: number;
  currency: string;
}

export interface PriceChartGeometry {
  width: number;
  height: number;
  /** Plot-area insets (room for the axis labels). */
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  /** One dot per captured point, oldest→newest. */
  points: ChartPixelPoint[];
  /** SVG `d` for the price line (oldest→newest). */
  linePath: string;
  /** SVG `d` for the soft area fill under the line (closed to the baseline). */
  areaPath: string;
  /** y-axis ticks — `amount` is the raw price the component renders (e.g. "49 kr"). */
  priceTicks: { cy: number; amount: number }[];
  /** x-axis ticks — `at` is the raw epoch the component formats as a short date. */
  dateTicks: { cx: number; at: number }[];
}

export interface ChartGeometryOpts {
  width?: number;
  height?: number;
  padLeft?: number;   // space for y-axis price labels
  padBottom?: number; // space for x-axis date labels
  padTop?: number;
  padRight?: number;
}

/**
 * Map captured price points onto an SVG chart. Returns null for <2 points (a
 * single dot is not a trend — the caller keeps the compact stat row instead).
 * A FLAT history (every point the same price) draws a centred horizontal line
 * rather than dividing by a zero span. Points are assumed chronological (the way
 * priceHistory appends them); we sort defensively so an out-of-order write can't
 * produce a tangled path.
 */
export function priceChartGeometry(
  points: PricePoint[] | undefined | null,
  opts: ChartGeometryOpts = {},
): PriceChartGeometry | null {
  if (!points || points.length < 2) return null;

  const width = opts.width ?? 320;
  const height = opts.height ?? 132;
  const plotLeft = opts.padLeft ?? 38;
  const plotBottom = height - (opts.padBottom ?? 22);
  const plotTop = opts.padTop ?? 10;
  const plotRight = width - (opts.padRight ?? 10);

  const sorted = [...points].sort((a, b) => a.at - b.at);
  const ats = sorted.map(p => p.at);
  const amounts = sorted.map(p => p.amount);
  const minAt = Math.min(...ats);
  const maxAt = Math.max(...ats);
  const minAmt = Math.min(...amounts);
  const maxAmt = Math.max(...amounts);
  const atSpan = maxAt - minAt;
  const amtSpan = maxAmt - minAmt;

  const xOf = (at: number): number =>
    atSpan === 0 ? (plotLeft + plotRight) / 2 : plotLeft + ((at - minAt) / atSpan) * (plotRight - plotLeft);
  const yOf = (amount: number): number =>
    amtSpan === 0 ? (plotTop + plotBottom) / 2 : plotBottom - ((amount - minAmt) / amtSpan) * (plotBottom - plotTop);

  const pixelPoints: ChartPixelPoint[] = sorted.map(p => ({
    cx: xOf(p.at),
    cy: yOf(p.amount),
    at: p.at,
    amount: p.amount,
    currency: p.currency,
  }));

  const linePath = pixelPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`)
    .join(' ');
  const first = pixelPoints[0];
  const last = pixelPoints[pixelPoints.length - 1];
  const areaPath = `${linePath} L${last.cx.toFixed(1)},${plotBottom.toFixed(1)} L${first.cx.toFixed(1)},${plotBottom.toFixed(1)} Z`;

  // y-axis: cheapest, middle, dearest (deduped when flat so a single price shows one tick).
  const midAmt = Math.round((minAmt + maxAmt) / 2);
  const priceTicks = [...new Set([maxAmt, midAmt, minAmt])].map(amount => ({
    cy: yOf(amount),
    amount,
  }));

  // x-axis: first + last, plus a middle tick once there's enough width to read it.
  const dateTicks =
    sorted.length >= 4
      ? [
          { cx: xOf(minAt), at: minAt },
          { cx: xOf(sorted[Math.floor(sorted.length / 2)].at), at: sorted[Math.floor(sorted.length / 2)].at },
          { cx: xOf(maxAt), at: maxAt },
        ]
      : [
          { cx: xOf(minAt), at: minAt },
          { cx: xOf(maxAt), at: maxAt },
        ];

  return {
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    points: pixelPoints,
    linePath,
    areaPath,
    priceTicks,
    dateTicks,
  };
}
