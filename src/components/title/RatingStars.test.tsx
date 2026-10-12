import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RatingStars from './RatingStars';

describe('RatingStars', () => {
  it('is a read-only image with a Swedish label', () => {
    const { getByRole } = render(<RatingStars rating={3.5} />);
    expect(getByRole('img', { name: 'Betyg 3.5 av 5' })).toBeTruthy();
  });

  it('draws a half star for a half step', () => {
    const { container } = render(<RatingStars rating={2.5} />);
    expect(container.textContent).toContain('halv stjärna');
  });

  it('has nothing to click', () => {
    const { container } = render(<RatingStars rating={3} />);
    expect(container.querySelectorAll('button, [role="radio"]').length).toBe(0);
  });
});
