// src/components/title/RatingsRow.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RatingsRow } from './RatingsRow';

describe('RatingsRow', () => {
  it('renders IMDb score when present', () => {
    render(<RatingsRow imdbId="tt1" ratings={{ imdb: { score: 8.4, votes: 100 }, rottenTomatoes: null, metacritic: null }} />);
    expect(screen.getByText(/8\.4/)).toBeInTheDocument();
  });

  it('renders RT only when present', () => {
    const { rerender } = render(<RatingsRow imdbId="tt1" ratings={{ imdb: { score: 7, votes: 1 }, rottenTomatoes: 91, metacritic: null }} />);
    // The value (91) and scale (%) are in sibling spans, so match the number alone
    expect(screen.getByText(/91/)).toBeInTheDocument();
    rerender(<RatingsRow imdbId="tt1" ratings={{ imdb: { score: 7, votes: 1 }, rottenTomatoes: null, metacritic: null }} />);
    // No RT card rendered — no "Rotten" label present
    expect(screen.queryByText(/Rotten/i)).not.toBeInTheDocument();
  });

  it('renders nothing when no ratings at all', () => {
    const { container } = render(<RatingsRow imdbId="tt1" ratings={{ imdb: null, rottenTomatoes: null, metacritic: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when ratings is null (still loading)', () => {
    const { container } = render(<RatingsRow imdbId="tt1" ratings={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
