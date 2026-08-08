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
// BIN-679: a SPY, not a bare stub. EpisodeReactions' (tmdbId, season, episode) triple
// IS the Firestore document key — `${tmdbId}_${season}_${episode}` — so the season
// this row hands it decides which thread the specials post into. Stub it to null and
// nothing notices a special writing into a numbered episode's reaction thread.
const episodeReactions = vi.hoisted(() => vi.fn());
vi.mock('@/components/tv/EpisodeReactions', () => ({
  default: (props: { tmdbId: number; season: number; episode: number; watched: boolean }) => { episodeReactions(props); return null; },
}));

function seasons(withSeason0: boolean): TMDBSeason[] {
  const numbered = [
    { id: 1, name: 'Säsong 1', season_number: 1, episode_count: 13, air_date: '2005-03-26', overview: '', poster_path: null },
    { id: 2, name: 'Säsong 2', season_number: 2, episode_count: 13, air_date: '2006-04-15', overview: '', poster_path: null },
  ] as TMDBSeason[];
  const specials = { id: 0, name: 'Specials', season_number: 0, episode_count: 199, air_date: '2005-11-21', overview: '', poster_path: null } as TMDBSeason;
  return withSeason0 ? [specials, ...numbered] : numbered;
}

// BIN-679: a spy, not a no-op. The season number a special's checkbox forwards is
// hardcoded at the call site, and the guard that protects the progress marker keys
// on exactly that number — so a call site passing 1 instead of 0 would defeat the
// whole ticket while every hook- and helper-level test stayed green.
const markEpisodeWatched = vi.fn(async () => {});

function renderList(
  tmdbId: number,
  withSeason0 = true,
  fromGroup?: string,
  isWatched: (season: number, episode: number) => boolean = () => false,
) {
  return render(
    <SeasonList
      tmdbId={tmdbId}
      seasons={seasons(withSeason0)}
      isWatched={isWatched}
      markEpisodeWatched={markEpisodeWatched}
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
    markEpisodeWatched.mockClear();
    episodeReactions.mockClear();
    groupState.group = null;
    groupState.members = [];
    groupState.progress = new Map();
  });

  it('shows the specials section for a curated show and lists ONLY the allow-listed episodes', () => {
    renderList(DW_REVIVAL);
    // Collapsed first: the section header is there, the episodes are not.
    expect(screen.getByText('Specialavsnitt')).toBeTruthy();
    expect(screen.queryByText(/The Day of the Doctor/)).toBeNull();

    fireEvent.click(screen.getByText('Specialavsnitt'));

    // Titles carry their air year since BIN-679 — pinned exactly in its own test
    // below; matched loosely here so this case stays about the ALLOW-LIST.
    expect(screen.getByText(/The Day of the Doctor/)).toBeTruthy();
    expect(screen.getByText(/The Waters of Mars/)).toBeTruthy();
    // The uncurated clutter it sits between stays hidden — that is the whole point
    // of the allow-list (season 0 has 199 entries for this show).
    expect(screen.queryByText(/Doctor Who at the Proms/)).toBeNull();

    // The header renders the curated length a SECOND time, next to the label. One
    // probe per rendering, not per number: without this the header and the `x/22`
    // counter below it could disagree on screen with nothing red.
    expect(screen.getByText('(22 avs)')).toBeTruthy();
  });

  it('does not fetch season 0 until the section is expanded', () => {
    renderList(DW_REVIVAL);
    expect(useTVSeason.mock.calls.some(([, season]) => season === 0)).toBe(false);

    fireEvent.click(screen.getByText('Specialavsnitt'));

    expect(useTVSeason.mock.calls.some(([id, season]) => id === DW_REVIVAL && season === 0)).toBe(true);
  });

  // BIN-679 reversed this deliberately. It used to assert ZERO checkboxes, because
  // ticking a special parked the watchlist marker on S0 (BIN-589). The guard now
  // lives in useEpisodeProgressWithSync — season 0 writes episodeProgress and never
  // touches the marker — so the affordance is safe and the ban is lifted.
  it('renders a checkbox per special, but still no bulk progress actions', () => {
    renderList(DW_REVIVAL);
    fireEvent.click(screen.getByText('Specialavsnitt'));

    // Exactly the two curated episodes the TMDB fixture returned — not three (the
    // uncurated Proms entry) and not zero. `toBeGreaterThan(0)` would go vacuous the
    // moment a neighbouring numbered row rendered its own checkbox.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(2);

    // Still absent, and NOT for the old reason: TMDB's season-0 numbering is sparse
    // (the curated list is a handful of numbers scattered through ~199 entries), so
    // "everything up to N" and a season episode-count are both meaningless here.
    expect(screen.queryByText('Markera alla sedda')).toBeNull();
    expect(screen.queryByText('Markera hit')).toBeNull();
  });

  // Criterion 1 is phrased about the USER ACTION, so the composition is what needs
  // proof: the hook guard and the helper exclusion are each pinned elsewhere, but
  // both key on the season number this call site hardcodes. Passing 1 here would
  // route a special down the numbered path and park the marker on it — with every
  // other test in the batch still green.
  it('forwards season 0 — and no episodeCount — when a special is ticked', () => {
    renderList(DW_REVIVAL);
    fireEvent.click(screen.getByText('Specialavsnitt'));

    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[boxes.length - 1]);

    // Exact args: 83 is "The Day of the Doctor", the last curated special in the
    // fixture. A 4th argument would be episodeCount, which drives the auto-advance
    // to the next season — meaningless for a sparse season 0.
    expect(markEpisodeWatched).toHaveBeenCalledTimes(1);
    expect(markEpisodeWatched).toHaveBeenCalledWith(0, 83, true);
  });

  // The OTHER thing the row's season number decides. `EpisodeReactions` turns
  // (tmdbId, season, episode) into the Firestore doc id `${tmdbId}_${season}_${ep}`,
  // so a row handing it season 1 would post curated special #2's reactions into
  // 57243_1_2 — the same thread as S1E02 "The End of the World", whose reactions are
  // spoiler-gated on having watched THAT episode. The section comment stakes #18
  // Community Manager's sign-off on this exact literal, so it gets pinned, not hoped.
  it('hands season 0 to the reactions thread, and labels the row S0', () => {
    renderList(DW_REVIVAL);
    fireEvent.click(screen.getByText('Specialavsnitt'));

    expect(screen.getByText('S0E83')).toBeTruthy();
    for (const call of episodeReactions.mock.calls) {
      expect(call[0].season).toBe(0);
      expect(call[0].tmdbId).toBe(DW_REVIVAL);
      // The spoiler gate's WIRING — not the gate itself. EpisodeReactions opens its
      // list only once you have marked the episode watched (`if (!watched) return`),
      // and the section comment stakes #18 Community Manager's sign-off on that. This
      // file mocks EpisodeReactions away, so it can only pin what the row FORWARDS;
      // the branch that implements the gate is still untested (BIN-821). Pinning the
      // hand-off is still worth it: EpisodeRow is the only place in the tree that
      // renders EpisodeReactions, and this is the only test file that reaches
      // EpisodeRow — so nothing else can catch a hardcoded prop here, and EpisodeRow
      // serves the numbered seasons too.
      expect(call[0].watched).toBe(false);
    }
    expect(episodeReactions.mock.calls.map(c => c[0].episode).sort((a, b) => a - b)).toEqual([14, 83]);
  });

  // The air year is the disambiguator on a 2005-2022 list with four Christmas
  // specials, and the shared EpisodeRow only shows a date for UNAIRED episodes.
  it('keeps the air year visible on each special', () => {
    renderList(DW_REVIVAL);
    fireEvent.click(screen.getByText('Specialavsnitt'));

    expect(screen.getByText('The Day of the Doctor (2013)')).toBeTruthy();
    expect(screen.getByText('The Waters of Mars (2009)')).toBeTruthy();
  });

  // The `watched` prop is the other half of the wiring: read it off the wrong season
  // and every special renders permanently unticked while the writes land correctly.
  it('reads the checked state from season 0, not from a numbered season', () => {
    renderList(DW_REVIVAL, true, undefined, (season, episode) => season === 0 && episode === 83);
    fireEvent.click(screen.getByText('Specialavsnitt'));

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map(b => b.checked)).toEqual([false, true]);

    // The other half of the spoiler-gate hand-off. Asserting only `false` above
    // pins one value, and a forwarded boolean pinned at one value is a half pin —
    // the same-value hardcode is always the survivor. `watched={false}` in
    // EpisodeRow would strand the reactions list permanently shut for EVERY episode
    // in the app, and passes the other test untouched. Map, not `.every`, so a
    // missing episode reads as undefined instead of vacuously true.
    const gate = new Map(episodeReactions.mock.calls.map(c => [c[0].episode, c[0].watched]));
    expect(gate.get(83)).toBe(true);
    expect(gate.get(14)).toBe(false);

    // And the UN-tick direction. Every other click in this file lands on an unchecked
    // box, so hardcoding `true` at the call site would leave a special permanently
    // stuck ticked with nothing red.
    fireEvent.click(boxes[1]);
    expect(markEpisodeWatched).toHaveBeenCalledWith(0, 83, false);
  });

  // The year guard's false branch. All three fixture episodes carry an air_date, so
  // dropping the guard entirely goes unnoticed — while live TMDB season-0 entries
  // routinely lack one, and the curated list is meant to grow. Without the guard the
  // title renders as "... (undefined)".
  it('leaves the title alone when a special has no air date', () => {
    useTVSeason.mockReturnValue({
      data: { episodes: [{ id: 904, episode_number: 14, name: 'Eve of the Daleks', overview: '', still_path: null, air_date: null, runtime: 60 }] },
      isLoading: false,
    });
    renderList(DW_REVIVAL);
    fireEvent.click(screen.getByText('Specialavsnitt'));

    expect(screen.getByText('Eve of the Daleks')).toBeTruthy();
  });

  // The counter is the one thing Malin parked the ticket to look at, so it gets an
  // assertion rather than a hope. The denominator is the CURATED list (22 entries for
  // Doctor Who), NOT the three-episode TMDB fixture and NOT TMDB's ~199 season-0
  // entries — counting either of those is the mistake this pins. The literal 22 is a
  // deliberate tripwire: deriving it from canonicalSpecialsFor() would compute the
  // expected value with the code under test, and adding a curated episode SHOULD force
  // a look at a user-visible counter.
  it('counts watched specials against the curated list, not the TMDB season', () => {
    renderList(DW_REVIVAL, true, undefined, (season, episode) => season === 0 && episode === 14);
    expect(screen.getByText('1/22')).toBeTruthy();
  });

  it('counts zero when nothing is ticked, and ignores watched NUMBERED episodes', () => {
    renderList(DW_REVIVAL, true, undefined, (season) => season === 1);
    expect(screen.getByText('0/22')).toBeTruthy();
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
