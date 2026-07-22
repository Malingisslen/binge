import Link from 'next/link';
import { titleHref } from '@/lib/tmdb/client';
import type { SeriesEntry } from '@/lib/tv/relatedSeries';

/**
 * "Samma serie" — a small strip of links to the OTHER TMDB entries of the same
 * fictional series (see src/lib/tv/relatedSeries.ts). Display only: it navigates
 * between eras of a split franchise (e.g. Doctor Who), it does not merge them.
 *
 * Static data + known ids → safe to render server-side (outside ClientOnly) so the
 * cross-links are crawlable. Renders nothing when there are no related entries.
 */
export default function RelatedSeriesStrip({ entries }: { entries: SeriesEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      {/* Standalone eyebrow style — do NOT reuse the `.kind` class: its CSS rule is
          scoped to `.detail-hero .chips-line .kind`, so it is inert here (and it pulls
          the phased-out --mono font). Mirrors the file's "Ditt betyg" label look. */}
      <span style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: 0.12, textTransform: 'uppercase', fontWeight: 500 }}>
        Samma serie
      </span>
      {entries.map((e) => (
        <Link
          key={e.id}
          href={titleHref('tv', e.id)}
          className="chip transition-colors hover:border-ink"
          style={{ textDecoration: 'none' }}
        >
          {e.label}
        </Link>
      ))}
    </div>
  );
}
