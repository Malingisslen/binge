import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SeasonList from './SeasonList';
import type { TMDBSeason } from '@/types';

// BIN-580 — the curated season-0 ("Specialavsnitt") section. Doctor Who 2005 keeps
// whole broadcast years in TMDB's season 0; the allow-list surfaces exactly those
// entries and nothing else, and only for curated shows.
const DW_REVIVAL = 57243;
const BREAKING_BAD = 1396;

// One TMDB season-0 payload: two curated episodes and one piece of the clutter that
// sits between them (S0E11 "Doctor Who at the Proms" is deliberately NOT curated).
const season0 = {
  episodes: [
    { id: 901, episode_number: 11, name: 'Doctor Who at the Proms', overview: '', still_path: null, air_date: '2009-01-01', runtime: 59 },
    { id: 902, episode_number: 14, name: 'The Waters of Mars', overview: 'Mars, 2059.', still_path: null, air_date: '2009-11-15', runtime: 63 },
    { id: 903, episode_number: 83, name: 'The Day of the Doctor', overview: '50-årsjubileet.', still_path: null, air_date: '2013-11-23', runtime: 77 },
  ],
};

const useTVSeason = vi.fn();
vi.mock('@/hooks/useTMDB', () => ({ useTVSeason: (id: number, season: number) => useTVSeason(id, season) }));

// Group spoiler-protection: `group` null = no protection. The lagging-member case
// below feeds two real progress positions so computeMaskBoundary (unmocked)
// produces a genuine boundary.
const groupState = vi.hoisted(() => ({
  group: null as { id: string } | null,
  members: [] as { uid: string; displayName: string }[],
  progress: new Map<string, Map<number, { lastWatchedSeason: number; lastWatchedEpisode: number }>>(),
}));
vi.mock('@/hooks/useGroups', () => ({ useGroup: () => ({ group: groupState.group, members: groupState.members }) }));
vi.mock('@/hooks/useGroupMemberProgress', () => ({ useGroupMemberProgress: () => groupState.progress }));
// The season rows pull in EpisodeReactions → useEpisodeReactions → the Firebase
// config module, which initialises the Auth SDK at import time. Stub the leaf so
// the real SeasonRow/EpisodeRow tree still renders.
vi.mock('@/components/tv/EpisodeReactions', () => ({ default: () => null }));

function seasons(withSeason0: boolean): TMDBSeason[] {
  const numbered = [
    { id: 1, name: 'Säsong 1', season_number: 1, episode_count: 13, air_date: '2005-03-26', overview: '', poster_path: null },
    { id: 2, name: 'Säsong 2', season_number: 2, episode_count: 13, air_date: '2006-04-15', overview: '', poster_path: null },
  ] as TMDBSeason[];
  const specials = { id: 0, name: 'Specials', season_number: 0, episode_count: 199, air_date: '2005-11-21', overview: '', poster_path: null } as TMDBSeason;
  return withSeason0 ? [specials, ...numbered] : numbered;
}

function renderList(tmdbId: number, withSeason0 = true, fromGroup?: string) {
  return render(
    <SeasonList
      tmdbId={tmdbId}
      seasons={seasons(withSeason0)}
      isWatched={() => false}
      markEpisodeWatched={async () => {}}
      markSeasonWatched={async () => {}}
      markSeasonUnwatched={async () => {}}
      getSeasonProgress={() => ({ watched: 0, total: 13 })}
      fromGroup={fromGroup}
    />
  );
}

describe('SeasonList — curated season-0 specials (BIN-580)', () => {
  beforeEach(() => {
    useTVSeason.mockReset();
    useTVSeason.mockReturnValue({ data: season0, isLoading: false });
    groupState.group = null;
    groupState.members = [];
    groupState.progress = new Map();
  });

  it('shows the specials section for a curated show and lists ONLY the allow-listed episodes', () => {
    renderList(DW_REVIVAL);
    // Collapsed first: the section header is there, the episodes are not.
    expect(screen.getByText('Specialavsnitt')).toBeTruthy();
    expect(screen.queryByText('The Day of the Doctor')).toBeNull();

    fireEvent.click(screen.getByText('Specialavsnitt'));

    expect(screen.getByText('The Day of the Doctor')).toBeTruthy();
    expect(screen.getByText('The Waters of Mars')).toBeTruthy();
    // The uncurated clutter it sits between stays hidden — that is the whole point
    // of the allow-list (season 0 has 199 entries for this show).
    expect(screen.queryByText('Doctor Who at the Proms')).toBeNull();
  });

  it('does not fetch season 0 until the section is expanded', () => {
    renderList(DW_REVIVAL);
    expect(useTVSeason.mock.calls.some(([, season]) => season === 0)).toBe(false);

    fireEvent.click(screen.getByText('Specialavsnitt'));

    expect(useTVSeason.mock.calls.some(([id, season]) => id === DW_REVIVAL && season === 0)).toBe(true);
  });

  it('renders the specials read-only — no checkboxes and no bulk progress actions', () => {
    renderList(DW_REVIVAL);
    fireEvent.click(screen.getByText('Specialavsnitt'));

    // Ticking a season-0 episode would park the watchlist progress marker on S0
    // (BIN-589), so the section deliberately carries no progress affordances.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText('Markera alla sedda')).toBeNull();
    expect(screen.queryByText('Markera hit')).toBeNull();
  });

  it('leaves the global hide-season-0 rule alone for uncurated shows', () => {
    renderList(BREAKING_BAD);
    expect(screen.queryByText('Specialavsnitt')).toBeNull();
    expect(screen.queryByText('Specials')).toBeNull();
  });

  it('skips the section when TMDB lists no season 0 for a curated show', () => {
    renderList(DW_REVIVAL, false);
    expect(screen.queryByText('Specialavsnitt')).toBeNull();
  });

  it('hides the specials while a group spoiler-mask is active, and shows them once it lifts', () => {
    groupState.group = { id: 'g1' };
    groupState.members = [
      { uid: 'a', displayName: 'Alva' },
      { uid: 'b', displayName: 'Bo' },
    ];
    // Bo is behind Alva → computeMaskBoundary returns a real boundary.
    groupState.progress = new Map([
      ['a', new Map([[DW_REVIVAL, { lastWatchedSeason: 2, lastWatchedEpisode: 5 }]])],
      ['b', new Map([[DW_REVIVAL, { lastWatchedSeason: 1, lastWatchedEpisode: 2 }]])],
    ]);
    const { unmount } = renderList(DW_REVIVAL, true, 'g1');
    expect(screen.getByText(/Spoiler-skydd aktivt/)).toBeTruthy();
    expect(screen.queryByText('Specialavsnitt')).toBeNull();
    unmount();

    // Same group view, everyone level → no boundary, so the section is back.
    groupState.progress = new Map([
      ['a', new Map([[DW_REVIVAL, { lastWatchedSeason: 2, lastWatchedEpisode: 5 }]])],
      ['b', new Map([[DW_REVIVAL, { lastWatchedSeason: 2, lastWatchedEpisode: 5 }]])],
    ]);
    renderList(DW_REVIVAL, true, 'g1');
    expect(screen.getByText('Specialavsnitt')).toBeTruthy();
  });

  it('still renders the numbered seasons untouched', () => {
    renderList(DW_REVIVAL);
    expect(screen.getByText(/Säsong 1/)).toBeTruthy();
    expect(screen.getByText(/Säsong 2/)).toBeTruthy();
  });
});
