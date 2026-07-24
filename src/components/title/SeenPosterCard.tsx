'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { posterUrl } from '@/lib/tmdb/client';

/**
 * Poster tile with a "Sedd"-badge, shared by the two franchise strips on a film
 * page: the TMDB-collection list (CollectionSection) and the curated cross-type
 * companion list (CompanionSection). Both show the same thing — "here are the
 * other films in this story, and here's which ones you've already seen" — so the
 * dimming, the badge and the title/year block live in one place.
 *
 * The component IS the link, so a caller that needs more per-tile chrome (the
 * "lägg i vill se"-button on companions) wraps it rather than passing children.
 */
export default function SeenPosterCard({
  href,
  title,
  year,
  posterPath,
  seen,
  isCurrent = false,
}: {
  href: string;
  title: string;
  /** Four-digit year, or empty/undefined to hide the line. */
  year?: string;
  posterPath: string | null;
  seen: boolean;
  /** The title whose page we're already on — marked for a11y, not dimmed. */
  isCurrent?: boolean;
}) {
  const poster = posterUrl(posterPath, 'w342');

  return (
    <Link
      href={href}
      style={{ textDecoration: 'none', color: 'inherit', position: 'relative', display: 'block' }}
      aria-current={isCurrent ? 'page' : undefined}
    >
      <div className="poster" style={{ opacity: seen ? 0.55 : 1 }}>
        {poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt={title} loading="lazy" decoding="async" width={342} height={513} />
        )}
        {seen && (
          <span
            title="Sedd"
            // Purely visual: the 55% dimming and this checkmark say nothing to a
            // screen reader, and `title` on a non-interactive span is not reliably
            // announced. The state is carried in the link's text below instead, so
            // hide this from the a11y tree rather than have it read as a bare icon.
            aria-hidden="true"
            style={{
              position: 'absolute', top: 6, right: 6,
              width: 22, height: 22, borderRadius: 999,
              background: 'var(--acc-deep)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Check size={13} strokeWidth={3} />
          </span>
        )}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: isCurrent ? 600 : 500, marginTop: 6, lineHeight: 1.25 }}>
        {title}
        {/* The only announceable carrier of the seen-state — it rides in the link's
            accessible name, so the tile reads "Titel — sedd" instead of being
            indistinguishable from an unseen one. */}
        {seen && <span className="sr-only"> — sedd</span>}
      </div>
      {year && <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1 }}>{year}</div>}
    </Link>
  );
}
