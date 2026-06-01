import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotFound } from './NotFound';

describe('NotFound', () => {
  it('renders a heading and the title text', () => {
    render(<NotFound title="Personen hittades inte." />);
    expect(screen.getByRole('heading', { name: 'Personen hittades inte.' })).toBeInTheDocument();
  });
});
