interface RatingStarsProps {
  rating: number | null;
  size?: 'sm' | 'md' | 'lg';
  dim?: boolean;
}

/** Read-only stars; setting a rating goes through `RatingInput`. */
export default function RatingStars({ rating, size = 'sm', dim = false }: RatingStarsProps) {
  const starSize = size === 'lg' ? 'text-xl' : size === 'md' ? 'text-base' : 'text-sm';

  return (
    <span
      role="img"
      aria-label={`Betyg ${rating ?? 0} av 5`}
      className={`${starSize} ${dim ? 'text-ink-3' : 'text-acc-deep'} font-semibold inline-flex select-none`}
    >
      {[1, 2, 3, 4, 5].map(star => {
        const display = rating ?? 0;
        const full = display >= star;
        const half = !full && display >= star - 0.5;
        return (
          <span key={star} className="relative inline-block">
            {full ? '★' : half ? (
              // En ritad halvstjärna: tecknet ⯪ saknas i många typsnitt och
              // såg olika ut i olika webbläsare.
              <>
                <span aria-hidden="true">☆</span>
                <span aria-hidden="true" className="absolute left-0 top-0 overflow-hidden" style={{ width: '50%' }}>★</span>
                <span className="sr-only">halv stjärna</span>
              </>
            ) : '☆'}
          </span>
        );
      })}
    </span>
  );
}
