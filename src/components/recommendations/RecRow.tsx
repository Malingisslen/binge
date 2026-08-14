'use client';

import { useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import { useInView } from '@/hooks/useInView';
import { rotatePool, isPoolExhausted } from '@/lib/recommendations/rowComposition';
import { RowExhaustionContext } from './rowExhaustionContext';
import RecCard from './RecCard';
import { LoadingView } from '@/components/ui/LoadingView';
import type { RowResult } from '@/types';
import { whyForRow } from './RecRow.helpers';

const ROW_VISIBLE = 6;
const ROTATION_KEY_PREFIX = 'binge:rec-rotation:';

function readSeed(rowKey: string): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(ROTATION_KEY_PREFIX + rowKey);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

// Direction H labelled-cascade row: numbered header (01–07), title, a short
// rationale next to it, a "visa fler →" exit, and a 6-grid of duotone rec
// cards. No horizontal scroll — the row is contained.
//
// The rationale is USUALLY one lowercase fragment, but the companion row
// deliberately carries a wrapping full sentence — Malin's call, 2026-08-14; the
// reason is in whyForRow's companion case in ./RecRow.helpers.ts. (The old
// wording said "in mono"; --mono has been an alias for --sans repo-wide since
// the mono face was dropped, so that was already stale.)

interface Props {
  result: RowResult;
  index: number; // 0-based; rendered as "01", "02", …
}

export default function RecRow({ result, index }: Props) {
  const { rowSpec, visible, backingPool, isLoading } = result;
  const [seed, setSeed] = useState<number>(() => readSeed(rowSpec.rowKey));

  const merged = [...visible, ...backingPool];
  const items = rotatePool(merged, seed, ROW_VISIBLE);
  const canRotate = merged.length > ROW_VISIBLE;
  // "Tapped out" = rotated through the whole pool at least once. Further blanda
  // only repeats, so we retire the row (demoted by the hub) instead of looping.
  const exhausted = isPoolExhausted(seed, merged.length, ROW_VISIBLE);

  const writeSeed = useCallback((next: number) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ROTATION_KEY_PREFIX + rowSpec.rowKey, String(next));
    }
    setSeed(next);
  }, [rowSpec.rowKey]);

  const onRotate = useCallback(() => writeSeed(seed + 1), [writeSeed, seed]);
  const onRestart = useCallback(() => writeSeed(0), [writeSeed]);

  // Report tapped-out state up so the hub can sink this row beneath fresher ones.
  // An empty pool (everything excluded) counts as tapped-out too — it would
  // otherwise occupy a visible slot rendering nothing. Don't report on unmount:
  // a demoted row that scrolls out of view must stay demoted, not bounce back.
  const report = useContext(RowExhaustionContext);
  const tappedOut = exhausted || (!isLoading && merged.length === 0);
  useEffect(() => {
    report(rowSpec.rowKey, tappedOut);
  }, [report, rowSpec.rowKey, tappedOut]);

  // Hämta providers först när raden är ~300px från viklinjen — annars fan-out:ar
  // /recommendations watch-providers för varje rad direkt vid mount (~6×rader).
  // once: behåll laddat när raden scrollats förbi.
  const { ref: rowRef, inView } = useInView<HTMLElement>({ rootMargin: '300px', once: true });
  const providerMap = useSearchProviders(inView ? items : []);

  if (!isLoading && items.length === 0) return null;

  const num = String(index + 1).padStart(2, '0');
  const whyLine = whyForRow(rowSpec);
  const expandHref = `/recommendations/?row=${encodeURIComponent(rowSpec.rowKey)}`;

  return (
    <section ref={rowRef} className="rec-cat" aria-labelledby={`rec-cat-${rowSpec.rowKey}`}>
      <div className="head">
        <div className="l">
          <span className="num">{num}</span>
          <h3 id={`rec-cat-${rowSpec.rowKey}`}>{rowSpec.label}</h3>
        </div>
        <div className="why">{whyLine}</div>
        <div className="rec-cat-actions">
          {canRotate && !exhausted && (
            <button
              type="button"
              onClick={onRotate}
              className="rotate"
              aria-label={`Visa nya förslag i ${rowSpec.label}`}
              title="Visa nya förslag"
            >
              <RefreshCw size={11} aria-hidden /> blanda
            </button>
          )}
          {canRotate && exhausted && (
            <button
              type="button"
              onClick={onRestart}
              className="rotate"
              aria-label={`Du har sett alla ${merged.length} förslag i ${rowSpec.label} — börja om`}
              title="Du har sett alla förslag här"
            >
              <RefreshCw size={11} aria-hidden /> alla {merged.length} visade · börja om
            </button>
          )}
          <Link href={expandHref} className="more">visa fler →</Link>
        </div>
      </div>
      <div className="rec-grid">
        {items.map(t => {
          const flatrate = providerMap[`${t.media_type}-${t.id}`]?.flatrate ?? [];
          return (
            <RecCard
              key={`${t.media_type}-${t.id}`}
              item={t}
              providers={flatrate}
            />
          );
        })}
      </div>
      {isLoading && items.length === 0 && (
        <LoadingView variant="grid" rows={ROW_VISIBLE} label="Laddar förslag…" />
      )}
    </section>
  );
}
