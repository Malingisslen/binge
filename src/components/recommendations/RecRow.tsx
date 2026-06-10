'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import { rotatePool } from '@/lib/recommendations/rowComposition';
import RecCard from './RecCard';
import { LoadingView } from '@/components/ui/LoadingView';
import type { RowResult, RowSpec } from '@/types';

const ROW_VISIBLE = 6;
const ROTATION_KEY_PREFIX = 'binge:rec-rotation:';

function readSeed(rowKey: string): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(ROTATION_KEY_PREFIX + rowKey);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

// Direction H labelled-cascade row: numbered header (01–07), title, a
// one-line rationale in mono next to it, a "visa fler →" exit, and a 6-grid
// of duotone rec cards. No horizontal scroll — the row is contained.

interface Props {
  result: RowResult;
  index: number; // 0-based; rendered as "01", "02", …
}

// Per-row rationale derived from the spec's id.kind. The mockup shows
// things like "vikt: 4,0 ★ · noir + svensk-dansk · liknande tonalitet" —
// we don't have all of that info, so we give a faithful but short line.
function whyForRow(spec: RowSpec): string {
  switch (spec.id.kind) {
    case 'trending':
      return 'populärt i Sverige · uppdaterat veckovis';
    case 'latest-fav':
      return 'drivande seed · färska 5★-betyg';
    case 'similar':
      return spec.meta?.seed ? 'matchar din seed-titel' : 'baserat på dina ratings';
    case 'person':
      return spec.meta?.person?.knownFor === 'director'
        ? 'samma regissör'
        : 'samma medverkande';
    case 'genre-canon':
      return 'kanon i din mest tittade genre';
    case 'thematic':
      return 'extraherat tema · ej genre';
    case 'upcoming':
      return 'kommande på dina tjänster';
  }
}

export default function RecRow({ result, index }: Props) {
  const { rowSpec, visible, backingPool, isLoading } = result;
  const [seed, setSeed] = useState<number>(() => readSeed(rowSpec.rowKey));

  const merged = [...visible, ...backingPool];
  const items = rotatePool(merged, seed, ROW_VISIBLE);
  const canRotate = merged.length > ROW_VISIBLE;

  const onRotate = useCallback(() => {
    setSeed(prev => {
      const next = prev + 1;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ROTATION_KEY_PREFIX + rowSpec.rowKey, String(next));
      }
      return next;
    });
  }, [rowSpec.rowKey]);

  const providerMap = useSearchProviders(items);

  if (!isLoading && items.length === 0) return null;

  const num = String(index + 1).padStart(2, '0');
  const whyLine = whyForRow(rowSpec);
  const expandHref = `/recommendations/?row=${encodeURIComponent(rowSpec.rowKey)}`;

  return (
    <section className="rec-cat" aria-labelledby={`rec-cat-${rowSpec.rowKey}`}>
      <div className="head">
        <div className="l">
          <span className="num">{num}</span>
          <h3 id={`rec-cat-${rowSpec.rowKey}`}>{rowSpec.label}</h3>
        </div>
        <div className="why">{whyLine}</div>
        <div className="rec-cat-actions">
          {canRotate && (
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
              whyLine={whyLine}
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
