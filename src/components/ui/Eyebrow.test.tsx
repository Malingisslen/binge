import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Eyebrow } from './Eyebrow';

describe('Eyebrow', () => {
  it('renders the small uppercase label as the element it is given', () => {
    render(<Eyebrow as="h2" className="mb-2">Kommande</Eyebrow>);
    const el = screen.getByRole('heading', { level: 2, name: 'Kommande' });
    expect(el.className).toBe('uppercase tracking-[0.5px] text-ink-3 text-xxs font-semibold mb-2');
  });

  it('the xs size is the bolder 11px variant', () => {
    render(<Eyebrow size="xs">Pausade</Eyebrow>);
    expect(screen.getByText('Pausade').className).toContain('text-xs font-bold');
  });
});
