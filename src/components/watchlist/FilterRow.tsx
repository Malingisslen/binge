'use client';

// BIN-44 — library filter row. Genre + min-rating chips over already-loaded
// watchlist data (no TMDB cost). Type + provider are handled elsewhere on the
// page (media chips + ?provider param). Uses the existing .chip primitive.

// BIN-161: betyg lagras på 0.5–5-skalan (RatingStars), inte 1–10. Chips på 6/7/8
// kunde aldrig matcha ett max-5-betyg. 3/4/4.5★ är meningsfulla trösklar.
const RATING_STEPS = [3, 4, 4.5] as const;

export default function FilterRow({
  genres,
  genreFilter,
  onToggleGenre,
  minRating,
  onSetMinRating,
}: {
  genres: { id: number; name: string }[];
  genreFilter: number[];
  onToggleGenre: (id: number) => void;
  minRating: number | null;
  onSetMinRating: (r: number | null) => void;
}) {
  if (genres.length === 0) return null;

  const groupLabel = 'text-[11px] uppercase tracking-[0.5px] text-ink-3 mr-1 shrink-0';

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 10, flexWrap: 'wrap' }}>
      <div className="flex items-center gap-[6px] flex-wrap">
        <span className={groupLabel}>Genre</span>
        {genres.map(g => (
          <button
            key={g.id}
            type="button"
            onClick={() => onToggleGenre(g.id)}
            className={`chip${genreFilter.includes(g.id) ? ' is-on' : ''}`}
          >
            {g.name}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-[6px]">
        <span className={groupLabel}>Betyg</span>
        {RATING_STEPS.map(r => (
          <button
            key={r}
            type="button"
            // Toggle: klick på aktivt steg rensar betygsfiltret.
            onClick={() => onSetMinRating(minRating === r ? null : r)}
            className={`chip${minRating === r ? ' is-on' : ''}`}
          >
            {r}+★
          </button>
        ))}
      </div>
    </div>
  );
}
