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
  // BIN-164: taggfilter — samma chip-mönster som genre. tags = de taggar som
  // faktiskt finns i listan (tagsInLibrary); tom → gruppen renderas inte.
  tags = [],
  tagFilter = [],
  onToggleTag,
  // BIN-UX: `vertical` staplar grupperna med block-etiketter så raden kan bo i den
  // infällbara filterpanelen (smal kolumn). Default = den gamla horisontella raden.
  vertical = false,
}: {
  genres: { id: number; name: string }[];
  genreFilter: number[];
  onToggleGenre: (id: number) => void;
  minRating: number | null;
  onSetMinRating: (r: number | null) => void;
  tags?: string[];
  tagFilter?: string[];
  onToggleTag?: (t: string) => void;
  vertical?: boolean;
}) {
  if (genres.length === 0 && tags.length === 0) return null;

  const groupLabel = vertical
    ? 'block text-[11px] uppercase tracking-[0.5px] text-ink-3 mb-[6px]'
    : 'text-[11px] uppercase tracking-[0.5px] text-ink-3 mr-1 shrink-0';
  const rowClass = vertical ? 'flex flex-col gap-4 items-stretch' : 'flex items-start gap-[10px] flex-wrap mt-[10px]';
  // Vertical: label ovanför en egen chip-wrap. Horisontellt: label + chip-wrap i rad.
  const groupClass = vertical ? 'flex flex-col items-start' : 'flex items-center gap-[6px] flex-wrap';
  const chipsWrap = 'flex flex-wrap gap-[6px]';

  return (
    <div className={rowClass}>
      {genres.length > 0 && (
        <div className={groupClass}>
          <span className={groupLabel}>Genre</span>
          <div className={chipsWrap}>
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
        </div>
      )}
      <div className={groupClass}>
        <span className={groupLabel}>Betyg</span>
        <div className={chipsWrap}>
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
      {tags.length > 0 && onToggleTag && (
        <div className={groupClass}>
          <span className={groupLabel}>Taggar</span>
          <div className={chipsWrap}>
            {tags.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => onToggleTag(t)}
                className={`chip${tagFilter.includes(t) ? ' is-on' : ''}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
