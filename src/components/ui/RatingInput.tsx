'use client';

import { useEffect, useRef, useState } from 'react';
import { Star, StarHalf } from 'lucide-react';
import { formatStars } from '@/lib/filters/titleFilters';

const HALF_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/** The half-star step under a horizontal position, 0.5–5. */
export function valueAtPosition(x: number, left: number, width: number): number {
  if (width <= 0) return 0.5;
  const share = Math.min(Math.max((x - left) / width, 0), 1);
  return Math.min(5, Math.max(0.5, Math.ceil(share * 10) / 2));
}

/**
 * The one place a rating is set. Five stars in half steps; the pointer position
 * picks the step, so every half star is as easy to hit as half a star is wide.
 * A mouse previews on hover, a finger previews while it is down and the rating
 * is set when it lifts. A swipe that starts on the stars scrolls instead of rating. `showValue` puts the number in a fixed-size slot, beside
 * the stars or (`'below'`) under them, so nothing moves while the pointer crosses.
 *
 * Each half star is also a real button, so keyboard and screen readers get the
 * same ten choices as touch and mouse.
 */
export function RatingInput({
  value, onSelect, labelFor, groupLabel, disabled = false, size = 20, showValue = false,
}: {
  value: number;
  onSelect: (stars: number) => void;
  labelFor: (stars: number) => string;
  groupLabel: string;
  disabled?: boolean;
  size?: number;
  showValue?: boolean | 'below';
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // A lifted finger is followed by a synthesized click on the button under it;
  // the lift already set the rating, so that click is ignored.
  const liftedAt = useRef(0);

  // After a lift the new rating takes a moment to come back through `value`
  // (it is written to Firestore first); hold the picked step so the stars do not
  // snap back to the old rating in between.
  useEffect(() => { if (!dragging.current) setPreview(null); }, [value]);
  useEffect(() => {
    if (preview === null || dragging.current || (typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches)) return;
    const t = setTimeout(() => setPreview(null), 1200);
    return () => clearTimeout(t);
  }, [preview]);

  const shown = preview ?? value;
  const at = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    return r ? valueAtPosition(clientX, r.left, r.width) : 0.5;
  };

  return (
    <div className={`inline-flex gap-2 ${showValue === 'below' ? 'flex-col items-start gap-1' : 'items-center'} ${disabled ? 'opacity-50' : ''}`}>
      <div
        ref={trackRef}
        role="group"
        aria-label={groupLabel}
        className="relative inline-flex text-acc-deep select-none"
        // The browser keeps scrolling in both directions, so a swipe over the stars
        // in a scrolling table scrolls it (pointercancel) instead of setting a rating.
        style={{ touchAction: 'pan-x pan-y' }}
        onPointerMove={e => {
          if (disabled) return;
          if (e.pointerType === 'mouse' || dragging.current) setPreview(at(e.clientX));
        }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') setPreview(null); }}
        onPointerDown={e => {
          if (disabled || e.pointerType === 'mouse') return;
          dragging.current = true;
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
          setPreview(at(e.clientX));
        }}
        onPointerUp={e => {
          if (!dragging.current) return;
          dragging.current = false;
          liftedAt.current = Date.now();
          const picked = at(e.clientX);
          setPreview(picked);
          onSelect(picked);
        }}
        onPointerCancel={() => { dragging.current = false; setPreview(null); }}
      >
        {[1, 2, 3, 4, 5].map(star => {
          const full = shown >= star;
          const half = !full && shown >= star - 0.5;
          return (
            <span key={star} className="inline-flex items-center justify-center [@media(pointer:coarse)]:min-h-11" style={{ width: size + 4, height: size + 10 }} aria-hidden>
              {full ? <Star size={size} fill="currentColor" />
                : half ? (
                  <span className="relative inline-flex">
                    <Star size={size} className="text-ink-3" />
                    <StarHalf size={size} fill="currentColor" className="absolute inset-0" />
                  </span>
                ) : <Star size={size} className="text-ink-3" />}
            </span>
          );
        })}
        <div className="absolute inset-0 flex">
          {HALF_STEPS.map(v => (
            <button
              key={v}
              type="button"
              disabled={disabled}
              onClick={() => { if (Date.now() - liftedAt.current > 600) onSelect(v); }}
              aria-pressed={value === v}
              aria-label={labelFor(v)}
              className={`h-full flex-1 bg-transparent border-0 p-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            />
          ))}
        </div>
      </div>
      {showValue && (
        <span
          aria-hidden
          className={`text-xs tabular-nums whitespace-nowrap ${shown ? 'font-semibold text-ink' : 'text-ink-3'}`}
          style={{ width: '10ch', minHeight: showValue === 'below' ? '1.25em' : undefined }}
        >
          {shown ? `${formatStars(shown)} av 5` : 'Inget betyg'}
        </span>
      )}
    </div>
  );
}
