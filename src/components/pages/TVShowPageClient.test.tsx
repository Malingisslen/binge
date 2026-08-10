// src/components/pages/TVShowPageClient.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The TV sibling of MoviePageClient.test.tsx, and it needs to exist separately.
// The provider derivation the two effects used to duplicate is now one shared
// helper (BIN-468, `src/lib/tmdb/seProviderIds.ts`), but everything AROUND it —
// each page's effect wiring, its payload key set, its paragraph renders — is
// still per-page, so a revert of one leaves the other's test green.
//
//  - BIN-598 — the lazy backfills must survive a LATE watchlist snapshot. Driven
//    with `isLoading: true` so every hook runs and the render short-circuits at
//    LoadingView. See MoviePageClient.test.tsx for why the whole loading→settled
//    transition has to be driven rather than just the settled frame.
//  - BIN-715/735 — the content floor ADDS text to a thin page, it never replaces
//    the show's own words. That needs the real body (`isLoading: false`), which
//    is exactly what this file could not do before BIN-715.

vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const setRuntime = vi.hoisted(() => vi.fn());
const refreshTmdbFields = vi.hoisted(() => vi.fn());
const watchlist = vi.hoisted(() => ({
  loading: true,
  snapshotSettled: false,
  listenerFailed: false,
  get libraryKnown(): boolean {
    return this.snapshotSettled && !this.listenerFailed;
  },
  items: [] as unknown[],
  getItem: () => undefined,
  updateRating: vi.fn(),
  updateNotes: vi.fn(),
  updateTmdbStatus: vi.fn(),
  updateTags: vi.fn(),
  setRuntime: vi.fn(),
  refreshTmdbFields: vi.fn(),
}));

// Stable identities across renders — deliberately STRICTER than production, not a
// preview of it. BIN-598 landed 2026-08-04 and left setRuntime/refreshTmdbFields
// out of its itemsRef migration on purpose (their per-snapshot identity re-fires
// these backfills), so production still churns here. Pinning stable identity is
// what makes these assertions test the `loading` gate rather than the churn.
watchlist.setRuntime = setRuntime;
watchlist.refreshTmdbFields = refreshTmdbFields;

const tmdb = vi.hoisted(() => ({ show: null as unknown, isLoading: true }));

const SHORT_OVERVIEW = 'En serie om ätten Stark.';
const LONG_OVERVIEW =
  'Sju ätter slåss om järntronen medan en äldre fiende vaknar bortom muren i norr.';

// The generated content-floor sentence for this fixture ends with its
// availability lead; that clause is unique to the floor, so its presence or
// absence answers "was the floor rendered?" (contentFloor.test.ts owns wording).
const FLOOR_TAIL = /Game of Thrones streamas just nu på Netflix i Sverige\./;

const show = {
  id: 1399,
  name: 'Game of Thrones',
  original_name: 'Game of Thrones',
  overview: LONG_OVERVIEW,
  first_air_date: '2011-04-17',
  episode_run_time: [57],
  poster_path: '/poster.jpg',
  status: 'Ended',
  number_of_seasons: 8,
  genres: [{ id: 18, name: 'Drama' }],
  seasons: [],
  'watch/providers': { results: { SE: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } },
};

vi.mock('@/hooks/useTMDB', () => ({ useTVShow: () => ({ data: tmdb.show, isLoading: tmdb.isLoading }) }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, uid: null, loading: false }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('@/hooks/useTitleRatings', () => ({ useTitleRatings: () => ({}) }));
vi.mock('@/hooks/useStreamingOffers', () => ({ useStreamingOffers: () => ({ offers: [] }) }));
vi.mock('@/hooks/useEpisodeProgressWithSync', () => ({
  useEpisodeProgressWithSync: () => ({
    isWatched: () => false,
    markEpisodeWatched: vi.fn(),
    markSeasonWatched: vi.fn(),
    markSeasonUnwatched: vi.fn(),
    getSeasonProgress: () => ({ watched: 0, total: 0 }),
  }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQueryClient: () => ({ prefetchQuery: vi.fn() }),
}));

// Children of the real body. Each owns its own Firestore listener, react-query
// call or provider context and has its own tests; stubbing them keeps this file
// about TVShowPageClient's own decisions.
vi.mock('@/components/title/JsonLd', () => ({
  JsonLd: () => null, tvSchema: () => ({}), breadcrumbSchema: () => ({}),
}));
// Rendered as null (the real one needs auth + watchlist context), but the props it
// RECEIVES are recorded. BIN-814: the movie twin had a blind `() => null` mock here
// and that is exactly how its subscription-provider prop went missing unnoticed —
// the mock hid the app's primary add control from every test. Same seam, same fix.
const statusButtonProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock('@/components/title/StatusButton', () => ({
  default: (props: Record<string, unknown>) => { statusButtonProps.last = props; return null; },
}));
vi.mock('@/components/title/RatingStars', () => ({ default: () => null }));
vi.mock('@/components/title/CommunityRating', () => ({ default: () => null }));
vi.mock('@/components/title/ProviderTag', () => ({ default: () => null }));
vi.mock('@/components/title/FreeWatchBadge', () => ({ default: () => null }));
vi.mock('@/components/title/AddToListButton', () => ({ default: () => null }));
vi.mock('@/components/title/AddToGroupButton', () => ({ default: () => null }));
vi.mock('@/components/title/NotInterestedButton', () => ({ default: () => null }));
vi.mock('@/components/title/NotesBlock', () => ({ default: () => null }));
vi.mock('@/components/title/TagEditor', () => ({ default: () => null }));
vi.mock('@/components/title/FriendsWhoSaw', () => ({ default: () => null }));
vi.mock('@/components/title/ReviewList', () => ({ default: () => null }));
vi.mock('@/components/title/PriceHistoryChart', () => ({ default: () => null }));
vi.mock('@/components/title/RecapPanel', () => ({ default: () => null }));
vi.mock('@/components/title/CheapestPathVerdict', () => ({ CheapestPathVerdict: () => null }));
vi.mock('@/components/title/RatingsRow', () => ({ RatingsRow: () => null }));
vi.mock('@/components/tv/SeasonList', () => ({ default: () => null }));
vi.mock('@/components/tv/RelatedSeriesStrip', () => ({ default: () => null }));
vi.mock('@/components/franchise/CompanionSection', () => ({ default: () => null }));
vi.mock('@/components/recommendations/RecCard', () => ({ default: () => null }));
vi.mock('@/components/ui/TrailerSection', () => ({ default: () => null }));
vi.mock('@/components/ui/JustWatchCredit', () => ({ default: () => null }));

import TVShowPageClient from './TVShowPageClient';
import type { TmdbDenormFields } from '@/lib/watchlist/tmdbFieldsRefresh';

beforeEach(() => {
  setRuntime.mockReset();
  refreshTmdbFields.mockReset();
  watchlist.loading = true;
  watchlist.snapshotSettled = false;
  watchlist.listenerFailed = false;
  watchlist.items = [];
  tmdb.show = show;
  tmdb.isLoading = true;
});

describe('TVShowPageClient — the lazy backfills wait for the watchlist (BIN-598)', () => {
  it('holds both backfills while the snapshot is still in flight, then fires them once it lands', () => {
    const { rerender } = render(<TVShowPageClient id="1399" />);

    expect(setRuntime).not.toHaveBeenCalled();
    expect(refreshTmdbFields).not.toHaveBeenCalled();

    watchlist.loading = false;
    rerender(<TVShowPageClient id="1399" />);

    expect(setRuntime).toHaveBeenCalledWith('tv', 1399, 57);
    expect(refreshTmdbFields).toHaveBeenCalledWith('tv', 1399, expect.objectContaining({
      title: 'Game of Thrones',
      providers: [8],
      tmdbStatus: 'Ended',
      runtime: 57,
    }));
  });
});

describe('TVShowPageClient — what the lazy refresh actually sends (BIN-468)', () => {
  // The TV twin of MoviePageClient's BIN-468 block, and it has to be its own copy:
  // the two pages call the same helper but assemble different payloads (tmdbStatus,
  // episode_run_time), so one page's green test says nothing about the other's.
  function lastRefreshPayload(overrides?: Record<string, unknown>): TmdbDenormFields {
    if (overrides) tmdb.show = { ...show, ...overrides };
    watchlist.loading = false;
    render(<TVShowPageClient id="1399" />);
    const calls = refreshTmdbFields.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][2] as TmdbDenormFields;
  }

  it('sends undefined providers when TMDB returned no SE block, so a good list is never blanked', () => {
    const payload = lastRefreshPayload({ 'watch/providers': { results: {} } });

    expect(payload.providers).toBeUndefined();
    // The static group still refreshes — an absent SE block says nothing about it.
    expect(payload.title).toBe('Game of Thrones');
    expect(payload.tmdbStatus).toBe('Ended');
  });

  it('sends undefined providers when the detail carries no watch/providers key at all', () => {
    const payload = lastRefreshPayload({ 'watch/providers': undefined });

    expect(payload.providers).toBeUndefined();
  });

  it('sends [] for a present-but-empty SE block — "nowhere in Sweden" is a real answer', () => {
    const payload = lastRefreshPayload({ 'watch/providers': { results: { SE: {} } } });

    expect(payload.providers).toEqual([]);
  });

  it('includes rent and buy, canonicalised and de-duplicated', () => {
    const payload = lastRefreshPayload({
      'watch/providers': {
        results: {
          SE: {
            flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],
            rent: [{ provider_id: 1944, provider_name: 'TV4 Play' }, { provider_id: 2, provider_name: 'Apple TV' }],
            buy: [{ provider_id: 489, provider_name: 'TV4 Play' }],
          },
        },
      },
    });

    // 1944 and 489 collapse to the canonical 489, which keeps its first position.
    expect(payload.providers).toEqual([8, 489, 2]);
  });

  it('denormalizes the ORIGINAL name, matching what addItem/StatusButton write', () => {
    const payload = lastRefreshPayload({ name: 'Maktkamp i Westeros', original_name: 'Game of Thrones' });

    expect(payload.title).toBe('Game of Thrones');
  });

  it('sends the series status but nothing the calendar owns', () => {
    const payload = lastRefreshPayload();

    // tmdbStatus is the one extra field the TV page denormalizes. nextAir*/
    // digitalReleaseDate stay with the calendar's repair path — writing them from
    // here is the 2026-07-11 attempt that was reverted for clobbering fresher data.
    //
    // BIN-814: `subscriptionProviders` joined the set deliberately. The two provider
    // fields must be written TOGETHER from one detail object — a page that sent only
    // the broad one would leave the advisor reading a subscription answer derived
    // from an older fetch, which is the drift this ticket ended.
    expect(Object.keys(payload).sort()).toEqual(
      ['genreIds', 'posterPath', 'providers', 'runtime', 'subscriptionProviders', 'title', 'tmdbStatus'],
    );
  });
});

describe('TVShowPageClient — the content floor adds text, it never replaces it (BIN-715/735)', () => {
  beforeEach(() => {
    watchlist.loading = false;
    watchlist.snapshotSettled = true;
    tmdb.isLoading = false;
  });

  it('keeps a short but genuine overview AND adds the generated sentence', () => {
    tmdb.show = { ...show, overview: SHORT_OVERVIEW };
    render(<TVShowPageClient id="1399" />);

    // The show's own words survive — the whole of BIN-735. A revert to the
    // either/or render drops this line.
    expect(screen.getByText(SHORT_OVERVIEW)).toBeTruthy();
    // …and the thin page still gains the extra prose it was written for.
    expect(screen.getByText(FLOOR_TAIL)).toBeTruthy();
  });

  it('does not add the generated sentence when the overview already carries the page', () => {
    render(<TVShowPageClient id="1399" />);

    expect(screen.getByText(LONG_OVERVIEW)).toBeTruthy();
    // BIN-715: the shared 60-character threshold is what decides this. Swap
    // hasSubstantialText for a bare truthiness check and the floor stops
    // appearing for the short overview above; drop the check entirely and it
    // appears here, duplicating a synopsis that needed no help.
    expect(screen.queryByText(FLOOR_TAIL)).toBeNull();
  });

  it('falls back to the generated sentence alone when TMDB has no Swedish overview', () => {
    // TMDB's sv-SE answer for an untranslated series is an empty string, not
    // null — which is why ~72% of series pages once shipped "Titel (år).".
    tmdb.show = { ...show, overview: '' };
    render(<TVShowPageClient id="1399" />);

    expect(screen.getByText(FLOOR_TAIL)).toBeTruthy();
  });
});

// BIN-814. The TV page hands its StatusButton a shared `statusButtonProps` object, so
// both render sites carry whatever it holds — which is exactly why the object's
// contents need pinning rather than trusting the spread.
describe('TVShowPageClient — the add control gets both provider answers (BIN-814)', () => {
  beforeEach(() => {
    watchlist.loading = false;
    watchlist.snapshotSettled = true;
    tmdb.isLoading = false;
    statusButtonProps.last = null;
  });

  it('passes the broad list and the subscription subset, and they differ correctly', () => {
    tmdb.show = {
      ...show,
      'watch/providers': {
        results: {
          SE: {
            flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],  // included
            rent: [{ provider_id: 76, provider_name: 'Viaplay' }],     // rentable only
            buy: [{ provider_id: 76, provider_name: 'Viaplay' }],
          },
        },
      },
    };
    render(<TVShowPageClient id="1399" />);

    const props = statusButtonProps.last!;
    expect(props).not.toBeNull();
    expect(props.providers).toEqual(expect.arrayContaining([8, 76]));
    expect(props.subscriptionProviders).toEqual([8]);
    expect(props.subscriptionProviders).not.toContain(76);
  });
});
