import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title and body', () => {
    render(<EmptyState title="Inga listor ännu" body="Skapa din första lista." />);
    expect(screen.getByText('Inga listor ännu')).toBeInTheDocument();
    expect(screen.getByText('Skapa din första lista.')).toBeInTheDocument();
  });

  it('renders an action when provided', () => {
    render(<EmptyState title="Tomt" action={<a href="https://example.com">Mina grupper</a>} />);
    expect(screen.getByRole('link', { name: 'Mina grupper' })).toBeInTheDocument();
  });
});
