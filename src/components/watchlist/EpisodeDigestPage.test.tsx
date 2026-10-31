import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EpisodeDigestPage from './EpisodeDigestPage';

const push = vi.fn();
const markRead = vi.fn();
const markEpisodeWatched = vi.fn();
let notifications: unknown[] = [];
let items: unknown[] = [];

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => ({ notifications, markRead }) }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => ({ items, loading: false }) }));
vi.mock('@/hooks/useEpisodeProgressWithSync', () => ({
  useEpisodeProgressWithSync: (tmdbId: number) => ({ markEpisodeWatched: (...a: unknown[]) => markEpisodeWatched(tmdbId, ...a) }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));

const digest = (read = false) => ({
  id: 'episode-digest-2026-10-31', kind: 'episode_digest', title: 'Igår kom 2 avsnitt du följer', read,
  episodes: [
    { tmdbId: 1, title: 'Andor', season: 2, episode: 5 },
    { tmdbId: 2, title: 'Bear', season: 1, episode: 3 },
  ],
});

describe('EpisodeDigestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifications = [digest()];
    items = [
      { mediaType: 'tv', tmdbId: 1, posterPath: null, lastWatchedSeason: 1, lastWatchedEpisode: 1 },
      { mediaType: 'tv', tmdbId: 2, posterPath: null, lastWatchedSeason: 1, lastWatchedEpisode: 3 },
    ];
  });

  it('lists every episode with series and code; only the unwatched one gets Sedd?', () => {
    render(<EpisodeDigestPage />);
    expect(screen.getByText('Andor')).toBeInTheDocument();
    expect(screen.getByText('S02E05')).toBeInTheDocument();
    expect(screen.getByText('S01E03')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /som sedd/ })).toHaveLength(1);
    expect(screen.getByLabelText('Bear markerad som sedd')).toBeInTheDocument();
  });

  it('Sedd? marks exactly that show and episode as watched', async () => {
    render(<EpisodeDigestPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Markera Andor S02E05 som sedd' }));
    await waitFor(() => expect(markEpisodeWatched).toHaveBeenCalledTimes(1));
    expect(markEpisodeWatched).toHaveBeenCalledWith(1, 2, 5, true);
  });

  it('opening the list marks the card read; an already read card is not written again', () => {
    render(<EpisodeDigestPage />);
    expect(markRead).toHaveBeenCalledWith('episode-digest-2026-10-31');
    markRead.mockClear();
    notifications = [digest(true)];
    render(<EpisodeDigestPage />);
    expect(markRead).not.toHaveBeenCalled();
  });

  it('skipping the list writes nothing; Klar leaves without marking any episode', () => {
    render(<EpisodeDigestPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Klar' }));
    expect(push).toHaveBeenCalledWith('/my/');
    expect(markEpisodeWatched).not.toHaveBeenCalled();
  });

  it('an empty card shows the empty state, not a list', () => {
    notifications = [{ ...digest(), episodes: [] }];
    render(<EpisodeDigestPage />);
    expect(screen.getByText('Inga nya avsnitt just nu.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Klar' })).toBeNull();
  });
});
