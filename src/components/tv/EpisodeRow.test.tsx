import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EpisodeRow from './EpisodeRow';
import type { TMDBEpisode } from '@/types';

// BIN-821 — EpisodeRow is the only place in the app that renders an episode's title,
// synopsis and still image, and the only place that mounts EpisodeReactions. It carries
// the OTHER spoiler gate: the group mask (Fas 2b), which blanks a row for a viewer who
// arrived from a group watchlist and is ahead of the slowest member.
//
// Everything the mask does is an ABSENCE, so a mutant that drops the `masked` branch (or
// that starts `revealed` at true) renders a perfectly normal, perfectly green row while
// spoiling the episode for the whole group. SeasonList.test.tsx reaches this component
// but stubs the reaction thread and never renders a masked row; nothing else touches it.

// EpisodeReactions pulls in useEpisodeReactions → the Firebase config module, which boots
// the Auth SDK at import time. Stubbed as a SPY, not a no-op (the BIN-679 pattern): what
// this row hands it — the (tmdbId, season, episode) triple and `watched` — decides which
// Firestore thread is read and whether the reaction gate is open, and this is the file
// that owns the "an unaired episode has no thread at all" rule.
const reactions = vi.hoisted(() => vi.fn());
vi.mock('@/components/tv/EpisodeReactions', () => ({
  default: (props: { tmdbId: number; season: number; episode: number; watched: boolean }) => {
    reactions(props);
    return <div data-testid="reactions" />;
  },
}));

// A fixed "today" rather than fake timers: the row's three time states (aired / today /
// unaired) are decided by a string comparison against todayIso(), and React's scheduler
// does not need to be dragged into a date question. 2026-03-15 is a Sunday; 2026-03-20 is
// the Friday after it.
const TODAY = '2026-03-15';
vi.mock('@/lib/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils')>()),
  todayIso: () => TODAY,
}));

const TMDB_ID = 1396;
const SEASON = 2;

function episode(over: Partial<TMDBEpisode> = {}): TMDBEpisode {
  return {
    id: 62088,
    episode_number: 5,
    season_number: SEASON,
    name: 'Fly',
    overview: 'Walt jagar en fluga genom hela labbet.',
    air_date: '2026-03-10',
    still_path: '/still.jpg',
    vote_average: 8.1,
    runtime: 47,
    ...over,
  };
}

const onToggle = vi.fn();
const onMarkUpTo = vi.fn();

function renderRow(over: Partial<TMDBEpisode> = {}, props: {
  watched?: boolean;
  spoilerMasked?: boolean;
  withMarkUpTo?: boolean;
} = {}) {
  const { watched = false, spoilerMasked = false, withMarkUpTo = true } = props;
  return render(
    <EpisodeRow
      episode={episode(over)}
      seasonNumber={SEASON}
      tmdbId={TMDB_ID}
      watched={watched}
      onToggle={onToggle}
      onMarkUpTo={withMarkUpTo ? onMarkUpTo : undefined}
      spoilerMasked={spoilerMasked}
    />
  );
}

describe('EpisodeRow — the group spoiler mask (BIN-821)', () => {
  beforeEach(() => {
    onToggle.mockClear();
    onMarkUpTo.mockClear();
    reactions.mockClear();
  });

  it('blanks the title, synopsis, still and reaction thread while masked', () => {
    const { container } = renderRow({}, { spoilerMasked: true });

    // Every field TMDB fills in is a spoiler for a group member who is behind: the
    // episode title alone gives away the twist on plenty of shows.
    expect(screen.queryByText('Fly')).toBeNull();
    expect(screen.queryByText(/Walt jagar en fluga/)).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText('47 min')).toBeNull();

    // …and the reaction thread is not merely closed, it is never mounted. Rendering it
    // masked would still let the *other* gate decide, and a watched episode would print
    // its reactions right under a hidden title.
    expect(reactions).not.toHaveBeenCalled();
    expect(screen.queryByTestId('reactions')).toBeNull();

    // What IS shown: the position in the season, and why the row is blank.
    expect(screen.getByText('S2E05')).toBeInTheDocument();
    expect(screen.getByText('Avsnitt 5')).toBeInTheDocument();
    expect(screen.getByText('Visa ändå')).toBeInTheDocument();
  });

  it('offers no way to tick a masked episode', () => {
    // Ticking a row you cannot read is how a mask becomes a data bug: it would mark an
    // episode watched (and advance the shared progress marker) sight unseen.
    renderRow({}, { spoilerMasked: true });

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Markera hit' })).toBeNull();
  });

  it('reveals the whole row on click — held, flipped, released', () => {
    // The reveal is a state that only exists after an interaction, so it has to be
    // DRIVEN. A mutant that initialises `revealed` to true passes any test that only
    // ever looks at the end state, and it un-masks every row in the season at once.
    const { container } = renderRow({}, { spoilerMasked: true, watched: true });
    expect(screen.queryByText('Fly')).toBeNull();

    fireEvent.click(screen.getByText('Visa ändå'));

    expect(screen.getByText('Fly')).toBeInTheDocument();
    expect(screen.getByText(/Walt jagar en fluga/)).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/still.jpg');
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(reactions).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Visa ändå')).toBeNull();
  });

  it('renders normally when no mask was requested', () => {
    // The false branch. Without it, "mask everything, always" is green.
    renderRow();

    expect(screen.getByText('Fly')).toBeInTheDocument();
    expect(screen.getByText(/Walt jagar en fluga/)).toBeInTheDocument();
    expect(screen.queryByText('Visa ändå')).toBeNull();
    expect(screen.getByTestId('reactions')).toBeInTheDocument();
  });
});

describe('EpisodeRow — episode code, runtime and air state (BIN-821)', () => {
  beforeEach(() => {
    onToggle.mockClear();
    onMarkUpTo.mockClear();
    reactions.mockClear();
  });

  it('zero-pads the episode number but never the season number', () => {
    // Both halves in one place: padding the season would print S02E05, and padding a
    // two-digit episode would print S2E012. Season 2 / episode 5 alone cannot see either.
    const { unmount } = renderRow({ episode_number: 5 });
    expect(screen.getByText('S2E05')).toBeInTheDocument();
    unmount();

    renderRow({ episode_number: 12 });
    expect(screen.getByText('S2E12')).toBeInTheDocument();
  });

  it('shows the runtime for an aired episode', () => {
    renderRow({ air_date: '2026-03-10' });

    expect(screen.getByText('47 min')).toBeInTheDocument();
  });

  it('replaces the runtime with the weekday and date for an episode still to come', () => {
    // An unaired episode has no runtime worth reading; what the viewer wants is WHEN.
    // 2026-03-20 is a Friday, so "fre 20/3" — the day and month are NOT zero-padded here
    // (that is the intentional difference from the SxxEyy code above).
    renderRow({ air_date: '2026-03-20' });

    expect(screen.getByText('fre 20/3')).toBeInTheDocument();
    expect(screen.queryByText('47 min')).toBeNull();
  });

  it('leaves the runtime cell empty when TMDB gives neither runtime nor a future date', () => {
    renderRow({ air_date: '2026-03-10', runtime: 0 });

    expect(screen.queryByText('47 min')).toBeNull();
    expect(screen.queryByText(/min$/)).toBeNull();
  });

  it('marks an episode airing today with the "nu" chip and takes the checkbox away', () => {
    // The boundary case in both directions: today is neither "aired, tick it" nor
    // "unaired, wait". A `>=` where the code has `>` would swallow this state entirely.
    renderRow({ air_date: TODAY });

    expect(screen.getByText('nu')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('keeps the checkbox for the day before, and for the day after', () => {
    // Guards the chip test above from going vacuous: without these, "never render a
    // checkbox" would pass, and so would "always render the nu chip".
    const { unmount } = renderRow({ air_date: '2026-03-14' });
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.queryByText('nu')).toBeNull();
    unmount();

    renderRow({ air_date: '2026-03-16' });
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.queryByText('nu')).toBeNull();
  });

  it('renders no still element at all when TMDB has no image', () => {
    // Not an empty <img>: a broken-image icon in every season list is what the guard
    // prevents, and `stillUrl(null)` returning a string would show exactly that.
    const { container } = renderRow({ still_path: null });

    expect(container.querySelector('img')).toBeNull();
  });

  it('omits the synopsis line when TMDB has no overview', () => {
    renderRow({ overview: '' });

    expect(screen.getByText('Fly')).toBeInTheDocument();
    expect(screen.queryByText(/Walt jagar en fluga/)).toBeNull();
  });
});

describe('EpisodeRow — marking progress (BIN-821)', () => {
  beforeEach(() => {
    onToggle.mockClear();
    onMarkUpTo.mockClear();
    reactions.mockClear();
  });

  it('reports both directions of the checkbox', () => {
    // A half pin is no pin: an `onToggle(true)` hardcode survives a test that only ever
    // clicks an unticked box, and leaves an episode permanently stuck watched.
    const { unmount } = renderRow({}, { watched: false });
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box).toHaveAccessibleName('Markera som sedd');

    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledWith(true);
    unmount();
    onToggle.mockClear();

    renderRow({}, { watched: true });
    const ticked = screen.getByRole('checkbox') as HTMLInputElement;
    expect(ticked.checked).toBe(true);
    expect(ticked).toHaveAccessibleName('Markera som osedd');

    fireEvent.click(ticked);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('runs "Markera hit" without also toggling the row it sits in', () => {
    // The handler calls stopPropagation for exactly this reason: the bulk action and the
    // single tick are different intents, and firing both marks one episode twice.
    renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Markera hit' }));

    expect(onMarkUpTo).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('hides "Markera hit" when it would be meaningless — watched, unaired, or unsupported', () => {
    const alreadyWatched = renderRow({}, { watched: true });
    expect(screen.queryByRole('button', { name: 'Markera hit' })).toBeNull();
    alreadyWatched.unmount();

    // "Everything up to here" cannot include an episode that has not aired.
    const notYetAired = renderRow({ air_date: '2026-03-20' });
    expect(screen.queryByRole('button', { name: 'Markera hit' })).toBeNull();
    notYetAired.unmount();

    // Callers that do not support the bulk action (the specials list) pass no handler.
    renderRow({}, { withMarkUpTo: false });
    expect(screen.queryByRole('button', { name: 'Markera hit' })).toBeNull();
  });
});

describe('EpisodeRow — what it hands the reaction thread (BIN-821)', () => {
  beforeEach(() => {
    onToggle.mockClear();
    onMarkUpTo.mockClear();
    reactions.mockClear();
  });

  it('forwards the exact tmdbId / season / episode triple', () => {
    // That triple IS the Firestore document key `${tmdbId}_${season}_${episode}`. The
    // three numbers are deliberately different from each other, so a swapped argument
    // cannot pass by coincidence — it would file the reactions under another episode.
    renderRow({ episode_number: 7 });

    expect(reactions).toHaveBeenCalledTimes(1);
    expect(reactions.mock.calls[0][0]).toMatchObject({ tmdbId: TMDB_ID, season: SEASON, episode: 7 });
  });

  it('forwards `watched` in both directions — it is the reaction gate', () => {
    // `watched={false}` hardcoded at this call site would shut every reaction thread in
    // the app forever; `watched={true}` would open every one of them to a viewer who has
    // not seen the episode. One value pinned is half a pin, so drive the flip.
    const { rerender } = renderRow({}, { watched: false });
    expect(reactions.mock.calls[0][0].watched).toBe(false);

    rerender(
      <EpisodeRow
        episode={episode()}
        seasonNumber={SEASON}
        tmdbId={TMDB_ID}
        watched
        onToggle={onToggle}
        onMarkUpTo={onMarkUpTo}
      />
    );

    expect(reactions.mock.calls.at(-1)?.[0].watched).toBe(true);
  });

  it('mounts no reaction thread for an episode that has not aired', () => {
    // Nobody can have watched it, so the thread could only hold speculation — and the
    // gate that normally protects it keys on `watched`, which is false for everyone.
    renderRow({ air_date: '2026-03-20' });

    expect(reactions).not.toHaveBeenCalled();
    expect(screen.queryByTestId('reactions')).toBeNull();
  });

  it('still mounts one for an episode airing today', () => {
    // The unaired guard is `air_date > today`, not `>=` — an episode that aired this
    // morning is watchable, so its thread is open. Pins the boundary from the other side.
    renderRow({ air_date: TODAY });

    expect(reactions).toHaveBeenCalledTimes(1);
  });
});
