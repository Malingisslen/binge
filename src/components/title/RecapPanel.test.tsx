import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecapPanel from './RecapPanel';
import type { EpisodeRef, SeasonEpisodes } from '@/lib/recaps/boundary';

// Mutable mock state so each test can vary what the data layer resolves. `coveredBoundary` can
// legitimately differ from the user's `boundary` prop on a fallback hit and MUST be the sole
// driver of the prior-season list (spoiler invariant). `unseeded`/`loading` model a partially-
// seeded show: seasons whose recap doc is absent or still in flight.
const state = vi.hoisted(() => ({
  text: 'Berättelsen så här långt vid gränsen.',
  textFull: undefined as string | undefined,
  coveredBoundary: { season: 4, episode: 2 } as EpisodeRef,
  unseeded: [] as number[],
  loading: [] as number[],
}));

const wikiSource = (slug: string) => [{ name: 'Wikipedia', url: `https://sv.wikipedia.org/wiki/${slug}`, license: 'CC BY-SA 4.0' }];

// useSeasonRecaps echoes the seasons it's given; a season in `loading` returns an in-flight
// result, one in `unseeded` returns a genuinely-absent (null) result — mirroring the real hook.
vi.mock('@/hooks/useRecap', () => ({
  useRecap: () => ({
    recap: {
      tmdbId: 1, season: state.coveredBoundary.season, episode: state.coveredBoundary.episode,
      text: state.text, textFull: state.textFull, lang: 'sv', model: 'test',
      sources: wikiSource('Show'), license: 'CC BY-SA 4.0', generatedAt: new Date(0), schemaVersion: 2,
    },
    coveredBoundary: state.coveredBoundary,
  }),
  useSeasonRecaps: (_tmdbId: number, seasons: number[]) =>
    seasons.map((season) => {
      if (state.loading.includes(season)) return { season, recap: null, isLoading: true };
      if (state.unseeded.includes(season)) return { season, recap: null, isLoading: false };
      return {
        season,
        recap: {
          tmdbId: 1, season, text: `Säsong ${season} handlade om äventyr.`, lang: 'sv', model: 'test',
          sources: wikiSource(`S${season}`), license: 'CC BY-SA 4.0', generatedAt: new Date(0), schemaVersion: 2,
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
