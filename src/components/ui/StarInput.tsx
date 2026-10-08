'use client';

import { Star, StarHalf } from 'lucide-react';

/**
 * Five stars in half steps. Each star is two real buttons (its left half and the
 * whole star), so a half star can be chosen by keyboard and touch, not only by
 * pointer position.
 */
export function StarInput({
  value, onSelect, labelFor, groupLabel, disabled = false, size = 18,
}: {
  value: number;
  onSelect: (stars: number) => void;
  labelFor: (stars: number) => string;
  groupLabel: string;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <div className={`inline-flex text-acc-deep ${disabled ? 'opacity-50' : ''}`} role="group" aria-label={groupLabel}>
      {[1, 2, 3, 4, 5].map(star => {
        const full = value >= star;
        const half = !full && value >= star - 0.5;
        return (
          <span key={star} className="relative inline-flex items-center justify-center" style={{ width: size + 2, height: size + 2 }}>
            {full ? <Star size={size} fill="currentColor" aria-hidden />
              : half ? (
                <span className="relative inline-flex" aria-hidden>
                  <Star size={size} className="text-ink-3" />
                  <StarHalf size={size} fill="currentColor" className="absolute inset-0" />
                </span>
              ) : <Star size={size} className="text-ink-3" aria-hidden />}
            {[star - 0.5, star].map((v, i) => (
              <button
                key={v}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(v)}
                aria-pressed={value === v}
                aria-label={labelFor(v)}
                className={`absolute top-0 h-full w-1/2 bg-transparent border-0 p-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${i === 0 ? 'left-0' : 'right-0'}`}
              />
            ))}
          </span>
        );
      })}
    </div>
  );
}
