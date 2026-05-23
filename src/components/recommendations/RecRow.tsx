'use client';

import Link from 'next/link';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import RecCard from './RecCard';
import type { RowResult, RowSpec } from '@/types';

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
  const items = visible.length >= 6
    ? visible.slice(0, 6)
    : [...visible, ...backingPool.slice(0, 6 - visible.length)];

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
        <Link href={expandHref} className="more">visa fler →</Link>
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
        <div style={{ padding: '24px 0', color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
          Laddar…
        </div>
      )}
    </section>
  );
}
