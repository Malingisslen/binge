'use client';

import { useState } from 'react';

interface RatingStarsProps {
  rating: number | null;
  onChange?: (rating: number) => void;
  size?: 'sm' | 'md' | 'lg';
  readonly?: boolean;
  dim?: boolean;
}

export default function RatingStars({ rating, onChange, size = 'sm', readonly = false, dim = false }: RatingStarsProps) {
  const [hover, setHover] = useState<number | null>(null);

  const display = hover ?? rating ?? 0;
  const starSize = size === 'lg' ? 'text-xl' : size === 'md' ? 'text-base' : 'text-sm';

  return (
    <span
      role={readonly ? 'img' : 'radiogroup'}
      aria-label={readonly ? `Betyg ${rating ?? 0} av 5` : 'Betyg'}
      className={`${starSize} ${dim ? 'text-ink-3' : 'text-acc-deep'} font-semibold inline-flex select-none ${readonly ? 'opacity-40 cursor-not-allowed' : ''}`}
      onMouseLeave={() => !readonly && setHover(null)}
    >
      {[1, 2, 3, 4, 5].map(star => {
        const full = display >= star;
        const half = !full && display >= star - 0.5;

        return (
          <span
            key={star}
            // A bare glyph is ~14px wide, too small for a finger, so touch screens
            // get a 40px box; mouse users keep the compact row used in tables.
            className={readonly ? '' : 'cursor-pointer inline-flex items-center justify-center [@media(pointer:coarse)]:min-w-10 [@media(pointer:coarse)]:min-h-10'}
            role={readonly ? undefined : 'radio'}
            aria-checked={readonly ? undefined : Math.ceil(rating ?? 0) === star}
            aria-label={readonly ? undefined : `Betyg ${star} av 5`}
            tabIndex={readonly ? undefined : 0}
            onKeyDown={(e) => {
              if (readonly || !onChange) return;
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(star); }
            }}
            onMouseEnter={() => !readonly && setHover(star)}
            onClick={(e) => {
              if (readonly || !onChange) return;
              // Measured on the glyph, not the padded box, so the half zone sits
              // on the star itself.
              const glyph = e.currentTarget.querySelector('[data-star-glyph]') ?? e.currentTarget;
              const rect = glyph.getBoundingClientRect();
              // Only the left third gives a half star, so a tap in the middle of
              // a star reliably gives the whole star.
              const isLeftHalf = e.clientX - rect.left < rect.width / 3;
              onChange(isLeftHalf ? star - 0.5 : star);
            }}
          >
            <span data-star-glyph className="relative inline-block">
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
          </span>
        );
      })}
    </span>
  );
}
