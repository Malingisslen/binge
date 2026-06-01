import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingView } from './LoadingView';

describe('LoadingView', () => {
  it('renders an accessible busy status with Swedish label', () => {
    render(<LoadingView label="Laddar session…" />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toHaveTextContent('Laddar session…');
  });

  it('renders shimmer rows for the grid variant', () => {
    const { container } = render(<LoadingView variant="grid" rows={4} />);
    expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(4);
  });
});
