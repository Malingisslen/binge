'use client';

import { useCommunityRating } from '@/hooks/useCommunityRating';

// BIN-104: "Binge-snitt" on title pages. Hidden below a sample threshold so a
// single early rating doesn't masquerade as a community score. Renders as a
// meta-row item matching the adjacent tmdb/imdb rows.
const MIN_SAMPLE = 5;

export default function CommunityRating({ mediaType, tmdbId }: { mediaType: 'movie' | 'tv'; tmdbId: number }) {
  const cr = useCommunityRating(mediaType, tmdbId);
  if (!cr || cr.count < MIN_SAMPLE) return null;
  // Binge ratings are a 5-star scale (RatingStars: 0.5–5). Convert ×2 to the
  // 0–10 scale so "Binge-snitt" sits next to the TMDB /10 row for comparison.
  const outOfTen = cr.avg * 2;
  return (
    <span>
      <span className="k">binge-snitt</span>
      <strong>{outOfTen.toFixed(1)} / 10</strong>
      <span className="text-ink-3"> · {cr.count} betyg</span>
    </span>
  );
}
