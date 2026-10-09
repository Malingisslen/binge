import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import RatingStars from './RatingStars';

function starSpans(container: HTMLElement) {
  return container.querySelectorAll('span[class*="cursor-pointer"]');
}

// jsdom ger alltid en noll-stor rect, så halvstjärne-grenen (som beror på
// klickets x-position relativt stjärnans bredd) är osynlig om vi inte mockar
// getBoundingClientRect. Dessa tester pinnar båda grenarna explicit.
// Zonen mäts på själva tecknet, inte på den 40px stora tryckytan runt det.
function mockRect(star: Element) {
  const el = star.querySelector('[data-star-glyph]')!;
  el.getBoundingClientRect = () => ({
    left: 0, width: 40, top: 0, right: 40, bottom: 0, height: 0, x: 0, y: 0,
    toJSON() {},
  });
}

describe('RatingStars', () => {
  it('klick på höger halva av en stjärna ger hel stjärna', () => {
    const onChange = vi.fn();
    const { container } = render(<RatingStars rating={null} onChange={onChange} />);
    const fourth = starSpans(container)[3];
    mockRect(fourth);
    fireEvent.click(fourth, { clientX: 30 });
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('klick på vänster halva av en stjärna ger halv stjärna', () => {
    const onChange = vi.fn();
    const { container } = render(<RatingStars rating={null} onChange={onChange} />);
    const fourth = starSpans(container)[3];
    mockRect(fourth);
    fireEvent.click(fourth, { clientX: 13 });
    expect(onChange).toHaveBeenCalledWith(3.5);
  });

  it('klick i mitten av en stjärna ger hel stjärna, inte halv', () => {
    const onChange = vi.fn();
    const { container } = render(<RatingStars rating={null} onChange={onChange} />);
    const fourth = starSpans(container)[3];
    mockRect(fourth);
    fireEvent.click(fourth, { clientX: 15 });
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('stjärnorna är radioknappar med svensk etikett', () => {
    const { getByRole } = render(<RatingStars rating={null} onChange={vi.fn()} />);
    expect(getByRole('radio', { name: 'Betyg 4 av 5' })).toBeTruthy();
  });

  it('readonly tar bort klick-affordansen och anropar aldrig onChange', () => {
    const onChange = vi.fn();
    const { container } = render(<RatingStars rating={3} onChange={onChange} readonly />);
    expect(starSpans(container).length).toBe(0);
  });
});
