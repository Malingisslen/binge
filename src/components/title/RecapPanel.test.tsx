import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecapPanel from './RecapPanel';
import type { EpisodeRef, SeasonEpisodes } from '@/lib/recaps/boundary';

// Mutable mock state so each test can vary what the data layer resolves. `coveredBoundary` can
// legitimately differ from the user's `boundary` prop on a fallback hit and MUST be the sole
// driver of the prior-season list (spoiler invariant). `unseeded`/`loading` model a partially-
// seeded show: seasons whose recap doc is absent or still in flight. `noBoundaryRecap` +
// `seasonOnlySeasons` model a season-only-sourced show (BIN-185 follow-up): no per-episode
// boundary doc exists at all, only whole-season docs for the listed season numbers.
const state = vi.hoisted(() => ({
  text: 'Berättelsen så här långt vid gränsen.',
  textFull: undefined as string | undefined,
  coveredBoundary: { season: 4, episode: 2 } as EpisodeRef,
  unseeded: [] as number[],
  loading: [] as number[],
  noBoundaryRecap: false,
  seasonOnlySeasons: [] as number[],
}));

const wikiSource = (slug: string) => [{ name: 'Wikipedia', url: `https://sv.wikipedia.org/wiki/${slug}`, license: 'CC BY-SA 4.0' }];

// useSeasonRecaps echoes the seasons it's given; a season in `loading` returns an in-flight
// result, one in `unseeded` returns a genuinely-absent (null) result — mirroring the real hook.
vi.mock('@/hooks/useRecap', () => ({
  useRecap: () => ({
    recap: state.noBoundaryRecap ? null : {
      tmdbId: 1, season: state.coveredBoundary.season, episode: state.coveredBoundary.episode,
      text: state.text, textFull: state.textFull, lang: 'sv', model: 'test',
      sources: wikiSource('Show'), license: 'CC BY-SA 4.0', generatedAt: new Date(0), schemaVersion: 2,
    },
    coveredBoundary: state.noBoundaryRecap ? null : state.coveredBoundary,
    seasonOnlySeasons: state.seasonOnlySeasons,
  }),
  // Respects the real hook's third (`enabled`/`open`) argument — the panel only fetches season
  // docs once opened, and a test asserting the toggle BUTTON renders before that must see truly
  // unresolved data pre-open, not a mock that always "loads" regardless of panel state (that gap
  // is exactly what let the real chicken-and-egg render bug slip past this suite once already —
  // security/code review, 2026-07-20).
  useSeasonRecaps: (_tmdbId: number, seasons: number[], enabled: boolean) =>
    seasons.map((season) => {
      if (!enabled) return { season, recap: null, isLoading: false };
      if (state.loading.includes(season)) return { season, recap: null, isLoading: true };
      if (state.unseeded.includes(season)) return { season, recap: null, isLoading: false };
      return {
        season,
        recap: {
          tmdbId: 1, season, text: `Säsong ${season} handlade om äventyr.`, lang: 'sv', model: 'test',
          sources: wikiSource(`S${season}`), license: 'CC BY-SA 4.0', generatedAt: new Date(0), schemaVersion: 2,
          episodeCoverage: 'full',
        },
        isLoading: false,
      };
    }),
}));

// Generous inventory so the fallback test yields a positive missing-episode count.
const inventory: SeasonEpisodes = [
  { season: 1, episodes: [1, 2] },
  { season: 2, episodes: [1, 2] },
  { season: 3, episodes: [1, 2, 3, 4, 5, 6, 7, 8] },
  { season: 4, episodes: [1, 2, 3, 4, 5] },
];

function open(boundary: EpisodeRef = { season: 4, episode: 2 }) {
  render(<RecapPanel tmdbId={1} boundary={boundary} inventory={inventory} />);
  fireEvent.click(screen.getByText('Påminn mig var jag slutade'));
}

beforeEach(() => {
  state.text = 'Berättelsen så här långt vid gränsen.';
  state.textFull = undefined;
  state.coveredBoundary = { season: 4, episode: 2 };
  state.unseeded = [];
  state.loading = [];
  state.noBoundaryRecap = false;
  state.seasonOnlySeasons = [];
});

describe('RecapPanel timeline', () => {
  it('shows the boundary "Du är här" node and its story-so-far as soon as the panel opens', () => {
    open();
    expect(screen.getByText('Du är här')).toBeInTheDocument();
    expect(screen.getByText('Säsong 4, avsnitt 2')).toBeInTheDocument();
    expect(screen.getByText('Berättelsen så här långt vid gränsen.')).toBeInTheDocument();
  });

  it('lists a node per prior completed season, collapsed by default', () => {
    open();
    expect(screen.getByRole('button', { name: /Säsong 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Säsong 2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Säsong 3/ })).toBeInTheDocument();
    expect(screen.queryByText(/Säsong 1 handlade om/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Säsong 2 handlade om/)).not.toBeInTheDocument();
  });

  it('anchors the boundary node ABOVE the prior-season nodes (async nodes append below → no reflow)', () => {
    open();
    const here = screen.getByText('Du är här');
    const seasonBtn = screen.getByRole('button', { name: /Säsong 3/ });
    // The season node must follow the boundary in DOM order — season docs resolve async and
    // append below, so top-anchoring is what keeps the story-so-far from shifting as they arrive.
    expect(here.compareDocumentPosition(seasonBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('expands each season INDEPENDENTLY — opening one does not open the others', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /Säsong 2/ }));
    expect(screen.getByText('Säsong 2 handlade om äventyr.')).toBeInTheDocument();
    expect(screen.queryByText('Säsong 1 handlade om äventyr.')).not.toBeInTheDocument();
    expect(screen.queryByText('Säsong 3 handlade om äventyr.')).not.toBeInTheDocument();

    // Opening S1 is additive, and does not collapse S2.
    fireEvent.click(screen.getByRole('button', { name: /Säsong 1/ }));
    expect(screen.getByText('Säsong 1 handlade om äventyr.')).toBeInTheDocument();
    expect(screen.getByText('Säsong 2 handlade om äventyr.')).toBeInTheDocument();
    expect(screen.queryByText('Säsong 3 handlade om äventyr.')).not.toBeInTheDocument();

    // Collapsing S2 leaves S1 open.
    fireEvent.click(screen.getByRole('button', { name: /Säsong 2/ }));
    expect(screen.queryByText('Säsong 2 handlade om äventyr.')).not.toBeInTheDocument();
    expect(screen.getByText('Säsong 1 handlade om äventyr.')).toBeInTheDocument();
  });

  it('hides seasons with no summary — a partially-seeded show shows no dead-end nodes', () => {
    state.unseeded = [2]; // S2's recap doc isn't seeded yet
    open();
    expect(screen.getByRole('button', { name: /Säsong 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Säsong 3/ })).toBeInTheDocument();
    // No node for the unseeded season, and no "no summary yet" dead-end text.
    expect(screen.queryByRole('button', { name: /Säsong 2/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ingen sammanfattning/)).not.toBeInTheDocument();
  });

  it('shows the boundary content (not a dead spinner) while prior-season docs are still loading', () => {
    state.loading = [1, 2, 3];
    open();
    // The already-loaded story-so-far is visible immediately…
    expect(screen.getByText('Berättelsen så här långt vid gränsen.')).toBeInTheDocument();
    // …no season nodes render until their docs resolve…
    expect(screen.queryByRole('button', { name: /^Säsong \d/ })).not.toBeInTheDocument();
    // …NO loading spinner (LoadingView renders role="status") — a spinner here would hang
    // forever on the all-error path, the exact bug this branch removes…
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // …and the boundary already sits in the timeline container during this mid-load window, so
    // there is no structural swap (→ no reflow) once the season docs resolve and append below.
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('carries an AI disclosure AND CC BY-SA attribution inside every expanded season (Art.50 + ADR-0011)', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /Säsong 1/ }));
    // Boundary node's disclosure + the opened season's own disclosure.
    expect(screen.getAllByText('AI-genererad sammanfattning').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('CC BY-SA 4.0').length).toBeGreaterThanOrEqual(2);
  });

  it('derives the prior-season list from coveredBoundary, not the raw boundary, on a fallback hit', () => {
    // User is at S4E5 but only an earlier recap (S3E8) is cached → the story-so-far covers S3E8.
    state.coveredBoundary = { season: 3, episode: 8 };
    open({ season: 4, episode: 5 });

    // The "here" header still reflects where the USER stopped…
    expect(screen.getByText('Säsong 4, avsnitt 5')).toBeInTheDocument();
    // …but the season nodes come from the COVERED boundary (S3) → only S1 and S2, never S3.
    expect(screen.getByRole('button', { name: /Säsong 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Säsong 2/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Säsong 3/ })).not.toBeInTheDocument();
    // The honest gap notice reports the 5 watched episodes (S4E1–E5) the recap misses.
    expect(screen.getByText(/de 5 senaste avsnitten/)).toBeInTheDocument();
  });

  it('renders only the boundary node when the user is in season 1 (no prior seasons)', () => {
    state.coveredBoundary = { season: 1, episode: 3 };
    open({ season: 1, episode: 3 });
    expect(screen.getByText('Säsong 1, avsnitt 3')).toBeInTheDocument();
    expect(screen.getByText('Berättelsen så här långt vid gränsen.')).toBeInTheDocument();
    // No prior-season nodes exist — the boundary is the sole timeline node (same dotted
    // structure as every other case, just with nothing beneath it).
    expect(screen.queryByRole('button', { name: /^Säsong/ })).not.toBeInTheDocument();
  });
});

describe('RecapPanel — season-only-sourced shows (BIN-185 follow-up)', () => {
  it('renders the toggle BUTTON itself before the panel is ever opened (the chicken-and-egg regression)', () => {
    // Regression test: `useSeasonRecaps` only resolves data once the panel is OPEN (`open`
    // starts false), so gating the component's render on ITS result (`loadedSeasons`) rather
    // than on the always-fetched index signal (`priorSeasons`) makes the button — which the
    // user needs to click to open the panel in the first place — permanently unreachable. Do
    // NOT call the `open()` test helper here; it renders AND clicks in one step, which would
    // hide this exact bug (caught twice independently — code review and security review,
    // 2026-07-20 — precisely because the rest of this file's tests always click through).
    state.noBoundaryRecap = true;
    state.seasonOnlySeasons = [1, 2, 3];
    render(<RecapPanel tmdbId={1} boundary={{ season: 4, episode: 2 }} inventory={inventory} />);
    expect(screen.getByText('Påminn mig var jag slutade')).toBeInTheDocument();
  });

  it('shows prior-season nodes with NO "Du är här" node when no per-episode boundary recap exists', () => {
    state.noBoundaryRecap = true;
    state.seasonOnlySeasons = [1, 2, 3];
    open({ season: 4, episode: 2 }); // the user's real watched boundary — season 4 in progress
    expect(screen.queryByText('Du är här')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Säsong 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Säsong 2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Säsong 3/ })).toBeInTheDocument();
  });

  it("never offers the user's CURRENT season, even if it is (wrongly) listed as season-only", () => {
    state.noBoundaryRecap = true;
    state.seasonOnlySeasons = [1, 2, 3, 4]; // season 4 included in the index — must still be excluded
    open({ season: 4, episode: 2 });
    expect(screen.getByRole('button', { name: /Säsong 3/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Säsong 4/ })).not.toBeInTheDocument();
  });

  it('filters to the seasons the index marks season-only even when MULTIPLE prior seasons exist (not just whichever happens to be the only one)', () => {
    // Deliberately a boundary with several candidate prior seasons (1-4) so that a naive
    // "any season-only coverage exists → offer every prior season unfiltered" implementation
    // would fail this test — a single-prior-season setup couldn't distinguish the two.
    state.noBoundaryRecap = true;
    state.seasonOnlySeasons = [1, 3]; // seasons 2 and 4 have NO season-only doc
    open({ season: 5, episode: 1 });
    expect(screen.getByRole('button', { name: /Säsong 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Säsong 3/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Säsong 2/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Säsong 4/ })).not.toBeInTheDocument();
  });

  it('unions season-only coverage WITH a per-episode boundary recap — a mixed show doesn\'t lose either', () => {
    // Code review (2026-07-20): a real show can have SOME seasons fully per-episode-covered and
    // a LATER season that only ever got season-level Wikipedia text (a documented common pattern
    // — see docs/recaps/RUNBOOK.md). Season 1 is fully per-episode covered (the "här" node's own
    // story), season 2 is season-only-sourced, and the user is currently on season 3. Both signals
    // must contribute: the "här" node (from the boundary recap) AND a Säsong 2 prior-season node
    // (from seasonOnlySeasons) — treating them as mutually exclusive would silently drop season 2
    // whenever a boundary recap ALSO existed, which is exactly the regression this test pins.
    state.noBoundaryRecap = false;
    state.coveredBoundary = { season: 1, episode: 10 };
    state.seasonOnlySeasons = [2];
    open({ season: 3, episode: 2 });
    expect(screen.getByText('Du är här')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Säsong 2/ })).toBeInTheDocument();
    // Season 1 is the "här" story's own covered season, never offered as a separate prior node.
    expect(screen.queryByRole('button', { name: /Säsong 1/ })).not.toBeInTheDocument();
  });

  it('only offers seasons the index actually marks season-only — not every prior season', () => {
    state.noBoundaryRecap = true;
    state.seasonOnlySeasons = [1]; // only season 1 has real season-only coverage
    open({ season: 2, episode: 1 }); // user just started season 2 — season 1 is prior
    expect(screen.getByRole('button', { name: /Säsong 1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Säsong 2/ })).not.toBeInTheDocument();
  });

  it('renders nothing when there is no boundary recap AND no season-only coverage for any prior season', () => {
    state.noBoundaryRecap = true;
    state.seasonOnlySeasons = [];
    const { container } = render(<RecapPanel tmdbId={1} boundary={{ season: 4, episode: 2 }} inventory={inventory} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the user has not started the show, even if seasonOnlySeasons has entries (fail-closed)', () => {
    state.noBoundaryRecap = true;
    state.seasonOnlySeasons = [1, 2, 3];
    const { container } = render(<RecapPanel tmdbId={1} boundary={null} inventory={inventory} />);
    expect(container.firstChild).toBeNull();
  });
});
