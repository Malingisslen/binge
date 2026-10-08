import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TrailerSection from './TrailerSection';

const video = { key: 'abc123', name: 'Officiell trailer', type: 'Trailer' };

describe('TrailerSection', () => {
  it('visar titelns bakgrundsbild från TMDB och laddar ingenting från YouTube före klick', () => {
    const { container } = render(<TrailerSection video={video} backdropPath="/bild.jpg" />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w780/bild.jpg');
    expect(container.innerHTML).not.toMatch(/youtube|ytimg/);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('laddar spelaren från youtube-nocookie först vid klick', () => {
    const { container } = render(<TrailerSection video={video} backdropPath="/bild.jpg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Spela trailer: Officiell trailer' }));
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/abc123?autoplay=1',
    );
  });

  it('visar den tomma platshållaren när titeln saknar bakgrundsbild', () => {
    const { container } = render(<TrailerSection video={video} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Spela trailer: Officiell trailer' })).toBeInTheDocument();
  });
});
