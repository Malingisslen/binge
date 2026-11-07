import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WatchlistItem } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));

import { WatchlistCard } from './WatchlistCard';

const item = {
  tmdbId: 1,
  mediaType: 'movie',
  title: 'Testfilmen',
  status: 'vill-se',
  genreIds: [],
  posterPath: null,
  rating: 7.5,
  providers: [],
} as unknown as WatchlistItem;

describe('WatchlistCard i markeringsläge', () => {
  it('markeras med mellanslag och Enter från tangentbordet', () => {
    const onToggle = vi.fn();
    render(<WatchlistCard item={item} selectMode onToggleSelect={onToggle} />);
    const box = screen.getByRole('checkbox', { name: 'Välj Testfilmen' });
    fireEvent.keyDown(box, { key: ' ' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('ignorerar andra tangenter', () => {
    const onToggle = vi.fn();
    render(<WatchlistCard item={item} selectMode onToggleSelect={onToggle} />);
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: 'a' });
    expect(onToggle).not.toHaveBeenCalled();
  });
});
