'use client';

import { useCommunityRating } from '@/hooks/useCommunityRating';
import { formatStars, roundToHalf } from '@/lib/filters/titleFilters';

// BIN-104: "Binge-snitt" on title pages. Hidden below a sample threshold so a
// single early rating doesn't masquerade as a community score. Renders as a
// meta-row item matching the adjacent tmdb/imdb rows.
const MIN_SAMPLE = 5;

export default function CommunityRating({ mediaType, tmdbId }: { mediaType: 'movie' | 'tv'; tmdbId: number }) {
  const cr = useCommunityRating(mediaType, tmdbId);
  if (!cr || cr.count < MIN_SAMPLE) return null;
  // Shown on the same five-star, half-step scale people rate on.
  const stars = roundToHalf(cr.avg);
  return (
    <span>
      <span className="k">binge-snitt</span>
      <strong aria-label={`${formatStars(stars)} av 5 stjärnor`}>{formatStars(stars)} ★</strong>
      <span className="text-ink-3"> · {cr.count} betyg</span>
    </span>
  );
}
