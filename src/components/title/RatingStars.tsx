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
      className={`${starSize} ${dim ? 'text-ink-3' : 'text-acc-deep'} font-semibold inline-flex select-none ${readonly ? 'opacity-40 cursor-not-allowed' : ''}`}
      onMouseLeave={() => !readonly && setHover(null)}
    >
      {[1, 2, 3, 4, 5].map(star => {
        const full = display >= star;
        const half = !full && display >= star - 0.5;

        return (
          <span
            key={star}
            className={`${readonly ? '' : 'cursor-pointer'} relative`}
            onMouseEnter={() => !readonly && setHover(star)}
            onClick={(e) => {
              if (readonly || !onChange) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const isLeftHalf = e.clientX - rect.left < rect.width / 2;
              onChange(isLeftHalf ? star - 0.5 : star);
            }}
          >
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
