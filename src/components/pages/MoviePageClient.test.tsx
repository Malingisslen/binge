// src/components/pages/MoviePageClient.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Three things are pinned here, and they need different amounts of the page:
//
//  1. BIN-598 — the two lazy backfills must survive a LATE watchlist snapshot.
//     Rendered with `isLoading: true`, so every hook and effect runs and the
//     render short-circuits at LoadingView before any child mounts.
//  2. BIN-730/731 — who may fire the cinema strip's "Bevaka släpp", and where a
//     signed-out tap goes.
//  3. BIN-715/735 — which paragraph(s) the page shows for a thin overview.
//
// (2) and (3) need the REAL page body, so they render with `isLoading: false`
// and stub the child components out. That is the whole reason BIN-715 existed:
// the old file only ever rendered the loading branch, so nothing downstream of
// it was pinned at all.
//
// BIN-598 detail, kept from the original file: setRuntime (BIN-93 runtime
// backfill) and refreshTmdbFields (BIN-402 TMDB lazy-refresh) both look the
// title up in the watchlist and early-return when it is not there. On a hard
// page load the snapshot ALWAYS lands after `mounted` flips, so their first run
// necessarily sees an empty library; they re-fire because `items` sits in both
// callbacks' dependency arrays. BIN-598 landed 2026-08-04 and deliberately left
// these two OUT of its itemsRef migration for exactly that reason. The mock
// below models STABLE identity anyway — a deliberately stricter world than
// production — so these assertions pin the `loading` gate on its own merits
// instead of passing on identity churn.

// The component's module graph reaches Firebase config, whose top-level getAuth()
// throws on the dummy test-env key. Nothing on the tested path touches it.
vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const setRuntime = vi.hoisted(() => vi.fn());
const refreshTmdbFields = vi.hoisted(() => vi.fn());
const upsertTitle = vi.hoisted(() => vi.fn());
const watchlist = vi.hoisted(() => ({
  loading: true,
  // BIN-730: the two primitives `libraryKnown` is derived from in
  // WatchlistContext, mirrored here so a test can express the states that
  // actually differ — cold load, settled, DEAD LISTENER, signed-out. A mock
  // that hard-coded `libraryKnown: true` would make every gate below vacuous,
  // and one that derived it from `loading` alone could not express the dead
  // listener at all (that is the state where `loading` goes false and the
  // library is still unknown — the whole point of BIN-596).
  snapshotSettled: false,
  listenerFailed: false,
  get libraryKnown(): boolean {
    return this.snapshotSettled && !this.listenerFailed;
  },
  items: [] as unknown[],
  getItem: () => undefined,
  upsertTitle,
  updateRating: vi.fn(),
  updateNotes: vi.fn(),
  updateWatchedAt: vi.fn(),
  updateTags: vi.fn(),
  setRuntime: vi.fn(),
  refreshTmdbFields: vi.fn(),
}));

// The identity of both callbacks is deliberately STABLE across renders — see the
// header. Handing back a fresh vi.fn() per call would make every BIN-598
// assertion below vacuous: the effects would re-fire on identity alone.
watchlist.setRuntime = setRuntime;
watchlist.refreshTmdbFields = refreshTmdbFields;

// ONE router object, not a per-call factory: a fresh mock per call would make
// every "did it navigate?" assertion below meaningless (lessons-digest).
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }));
const auth = vi.hoisted(() => ({ user: null as unknown, uid: null as string | null, loading: false }));
const tmdb = vi.hoisted(() => ({ movie: null as unknown, isLoading: true }));

const SHORT_OVERVIEW = 'En dokumentär om Greta Thunberg.';
const LONG_OVERVIEW =
  'En hacker upptäcker att verkligheten är en simulering och dras in i ett krig om mänsklighetens framtid.';

// The generated content-floor sentence for this fixture ends with its
// availability lead; that clause is unique to the floor, so its presence or
// absence answers "was the floor rendered?" without duplicating the whole
// template here (contentFloor.test.ts owns the wording).
const FLOOR_TAIL = /The Matrix streamas just nu på Netflix i Sverige\./;

const movie = {
  id: 603,
  title: 'The Matrix',
  original_title: 'The Matrix',
  overview: LONG_OVERVIEW,
  release_date: '1999-03-30',
  runtime: 136,
  poster_path: '/poster.jpg',
  genres: [{ id: 878, name: 'Science Fiction' }],
  'watch/providers': { results: { SE: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } },
  // In Swedish cinemas since 2020, home release far in the future → the BIN-193
  // countdown strip renders. A far-future date keeps the fixture from expiring.
  release_dates: {
    results: [{
      iso_3166_1: 'SE',
      release_dates: [
        { type: 3, release_date: '2020-01-01T00:00:00.000Z' },
        { type: 4, release_date: '2099-01-01T00:00:00.000Z' },
      ],
    }],
  },
};

vi.mock('@/hooks/useTMDB', () => ({ useMovie: () => ({ data: tmdb.movie, isLoading: tmdb.isLoading }) }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('@/hooks/useTitleRatings', () => ({ useTitleRatings: () => ({}) }));
vi.mock('@/hooks/useStreamingOffers', () => ({ useStreamingOffers: () => ({ offers: [] }) }));
vi.mock('@/hooks/useCineasternaCatalog', () => ({
  useCineasternaCatalog: () => ({ has: () => false, rentalFor: () => undefined }),
}));
// BIN-1025 follow-up: ONE spy, hoisted. A factory returning a fresh `vi.fn()` per call
// makes every assertion about what the user was told vacuous — the test would hold a
// different function than the component called.
const toastShow = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toastShow }) }));

// Children of the real body. Each of these owns its own Firestore listener,
// react-query call or provider context and has its own tests; stubbing them
// keeps this file about MoviePageClient's own decisions. CinemaCountdownStrip is
// deliberately NOT stubbed — its button is the subject of the BIN-730/731 tests.
vi.mock('@/components/title/JsonLd', () => ({
  JsonLd: () => null, movieSchema: () => ({}), breadcrumbSchema: () => ({}),
}));
// Rendered as null (the real one needs auth + watchlist context), but the props it
// RECEIVES are recorded. BIN-814: a `() => null` mock made the movie page's primary
// add control unobservable, and that is precisely where the subscription-provider
// prop went missing while every other call site on the page had it.
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
vi.mock('@/components/title/WatchedDateEditor', () => ({ default: () => null }));
vi.mock('@/components/title/NotesBlock', () => ({ default: () => null }));
vi.mock('@/components/title/TagEditor', () => ({ default: () => null }));
vi.mock('@/components/title/FriendsWhoSaw', () => ({ default: () => null }));
vi.mock('@/components/title/ReviewList', () => ({ default: () => null }));
vi.mock('@/components/title/CollectionSection', () => ({ default: () => null }));
vi.mock('@/components/title/PriceHistoryChart', () => ({ default: () => null }));
vi.mock('@/components/title/CheapestPathVerdict', () => ({ CheapestPathVerdict: () => null }));
vi.mock('@/components/title/RatingsRow', () => ({ RatingsRow: () => null }));
vi.mock('@/components/franchise/CompanionSection', () => ({ default: () => null }));
vi.mock('@/components/recommendations/RecCard', () => ({ default: () => null }));
vi.mock('@/components/ui/TrailerSection', () => ({ default: () => null }));
vi.mock('@/components/ui/JustWatchCredit', () => ({ default: () => null }));

import MoviePageClient from './MoviePageClient';
import type { TmdbDenormFields } from '@/lib/watchlist/tmdbFieldsRefresh';

/** Reset to a signed-in visitor whose library has settled, showing the body. */
function signedInWithSettledLibrary() {
  auth.uid = 'uid-1';
  auth.loading = false;
  watchlist.loading = false;
  watchlist.snapshotSettled = true;
  watchlist.listenerFailed = false;
  tmdb.isLoading = false;
}

beforeEach(() => {
  setRuntime.mockReset();
  refreshTmdbFields.mockReset();
  // Resolves by default: the "Bevaka" handler now chains the toast onto the write, so a
  // mock returning undefined would throw rather than test anything.
  upsertTitle.mockReset();
  upsertTitle.mockResolvedValue(undefined);
  toastShow.mockReset();
  router.push.mockReset();
  watchlist.loading = true;
  watchlist.snapshotSettled = false;
  watchlist.listenerFailed = false;
  watchlist.items = [];
  auth.user = null;
  auth.uid = null;
  auth.loading = false;
  tmdb.movie = movie;
  tmdb.isLoading = true;
});

describe('MoviePageClient — the lazy backfills wait for the watchlist (BIN-598)', () => {
  it('holds both backfills while the snapshot is still in flight, then fires them once it lands', () => {
    const { rerender } = render(<MoviePageClient id="603" />);

    // Cold load: the library is unknown, so writing now would look the title up
    // in an empty list and no-op forever.
    expect(setRuntime).not.toHaveBeenCalled();
    expect(refreshTmdbFields).not.toHaveBeenCalled();

    // The snapshot lands. NOTE the callback identities do not change — that is
    // precisely why the effects need `loading` in their dependency arrays.
    watchlist.loading = false;
    rerender(<MoviePageClient id="603" />);

    expect(setRuntime).toHaveBeenCalledWith('movie', 603, 136);
    expect(refreshTmdbFields).toHaveBeenCalledWith('movie', 603, expect.objectContaining({
      title: 'The Matrix',
      providers: [8],
      runtime: 136,
    }));
  });
});

describe('MoviePageClient — what the lazy refresh actually sends (BIN-468)', () => {
  // These drive the effect only, so they render on the loading branch (every hook
  // still runs). `watchlist.loading = false` is the snapshot landing; without it the
  // effect is held and every assertion below would be vacuously true.
  function lastRefreshPayload(overrides?: Record<string, unknown>): TmdbDenormFields {
    if (overrides) tmdb.movie = { ...movie, ...overrides };
    watchlist.loading = false;
    render(<MoviePageClient id="603" />);
    const calls = refreshTmdbFields.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][2] as TmdbDenormFields;
  }

  it('sends undefined providers when TMDB returned no SE block, so a good list is never blanked', () => {
    // The dangerous case. `undefined` makes planTmdbFieldsRefresh skip the
    // providers group entirely; `[]` would be written and would wipe the
    // denormalized ids the advisor and the ToS sweep both read.
    const payload = lastRefreshPayload({ 'watch/providers': { results: {} } });

    expect(payload.providers).toBeUndefined();
    // The static group still refreshes — an absent SE block says nothing about it.
    expect(payload.title).toBe('The Matrix');
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
            // 1944 is TMDB's current id for TV4 Play; 489 is ours. Both appear, one
            // must survive — otherwise the doc claims two subscriptions for one.
            rent: [{ provider_id: 1944, provider_name: 'TV4 Play' }, { provider_id: 2, provider_name: 'Apple TV' }],
            buy: [{ provider_id: 489, provider_name: 'TV4 Play' }],
          },
        },
      },
    });

    // 1944 and 489 collapse to the canonical 489, which keeps its first position.
    expect(payload.providers).toEqual([8, 489, 2]);
  });

  it('denormalizes the ORIGINAL title, matching what upsertTitle/StatusButton write', () => {
    // Otherwise a title-page view rewrites a correctly-stored English title with
    // TMDB's Swedish one on every visit, and the library flips between the two.
    const payload = lastRefreshPayload({ title: 'Matrix', original_title: 'The Matrix' });

    expect(payload.title).toBe('The Matrix');
  });

  it('never sends updatedAt-adjacent fields it has no business writing', () => {
    const payload = lastRefreshPayload();

    // The title page owns the static group + BOTH provider fields. nextAir*/
    // digitalReleaseDate belong to the calendar's repair path — the 2026-07-11
    // attempt that wrote them from here was reverted for clobbering fresher values
    // (see BIN-468's body).
    //
    // BIN-814: `subscriptionProviders` joined the set deliberately. The two provider
    // fields must be written TOGETHER from one detail object — a page that sent only
    // the broad one would leave the advisor reading a subscription answer derived
    // from an older fetch, which is the drift this ticket ended.
    expect(Object.keys(payload).sort()).toEqual(
      ['genreIds', 'posterPath', 'providers', 'runtime', 'subscriptionProviders', 'title'],
    );
  });
});

describe('MoviePageClient — who may fire "Bevaka släpp" (BIN-730/596/731)', () => {
  const bevaka = () => screen.queryByRole('button', { name: /Bevaka släpp/ });

  it('offers the CTA once the library is genuinely known, and it writes', () => {
    signedInWithSettledLibrary();
    render(<MoviePageClient id="603" />);

    fireEvent.click(bevaka()!);

    expect(upsertTitle).toHaveBeenCalledWith(expect.objectContaining({
      tmdbId: 603, mediaType: 'movie', status: 'vill_se',
    }));
  });

  it('confirms the watch only once the write has landed', async () => {
    signedInWithSettledLibrary();
    render(<MoviePageClient id="603" />);

    await act(async () => { fireEvent.click(bevaka()!); });

    expect(toastShow).toHaveBeenCalledWith(expect.stringContaining('Bevakar släppet'));
  });

  it('says NOTHING when the write is refused during an account deletion', async () => {
    // BIN-1025 made `writeTitle` refuse by throwing. This handler fired its toast
    // unconditionally beside a `void`ed call, which was true only while the write always
    // landed — so that change turned it into a confirmation of a write Firestore never
    // accepted. The BIN-895 false-confirmation class, reachable again.
    //
    // Silence is not the end state anyone wants (BIN-1038 owns what every silent caller
    // should say), but silence and a lie are different defects, and only one of them is
    // this batch's to leave behind.
    signedInWithSettledLibrary();
    upsertTitle.mockRejectedValueOnce(
      new Error('binge/deletion-in-progress: kontot håller på att raderas'),
    );
    render(<MoviePageClient id="603" />);

    await act(async () => { fireEvent.click(bevaka()!); });

    expect(upsertTitle).toHaveBeenCalled();
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('offers nothing to a signed-in visitor whose listener died, so the CTA cannot write', () => {
    signedInWithSettledLibrary();
    // The BIN-596 state: `loading` has gone false, but not because a snapshot
    // arrived — the listen terminally errored. getItem now lies about every
    // title, so an add would hard-write status 'vill_se' over a film the user
    // already marked 'sedd'. A gate written as `!loading` would let it through.
    watchlist.listenerFailed = true;
    render(<MoviePageClient id="603" />);

    expect(bevaka()).toBeNull();
    expect(upsertTitle).not.toHaveBeenCalled();
    // /login is not the answer to a broken library — they ARE signed in.
    expect(router.push).not.toHaveBeenCalled();
  });

  it('offers nothing while the first snapshot is still in flight', () => {
    signedInWithSettledLibrary();
    watchlist.loading = true;
    watchlist.snapshotSettled = false;
    render(<MoviePageClient id="603" />);

    expect(bevaka()).toBeNull();
  });

  it('shows a signed-out visitor the whole row and sends the tap to /login (BIN-731)', () => {
    signedInWithSettledLibrary();
    // A signed-out visitor has no listener at all: `loading` goes false with
    // `snapshotSettled` still false, so `libraryKnown` is false for them for the
    // rest of the session. Gating the row on it hid the release date itself.
    auth.uid = null;
    watchlist.snapshotSettled = false;
    render(<MoviePageClient id="603" />);

    // The information is there for them…
    expect(screen.getByText(/På bio nu/)).toBeTruthy();
    // …and the tap has a destination rather than being a dead click or a lie.
    fireEvent.click(bevaka()!);
    expect(router.push).toHaveBeenCalledWith('/login/');
    expect(upsertTitle).not.toHaveBeenCalled();
  });

  it('waits for the auth verdict before treating anyone as signed out', () => {
    signedInWithSettledLibrary();
    auth.uid = null;
    auth.loading = true;
    watchlist.snapshotSettled = false;
    render(<MoviePageClient id="603" />);

    // Unknown is not "signed out": routing to /login here would bounce a
    // signed-in visitor out of their own page mid-restore.
    expect(bevaka()).toBeNull();
  });
});

describe('MoviePageClient — the content floor adds text, it never replaces it (BIN-715/735)', () => {
  it('keeps a short but genuine overview AND adds the generated sentence', () => {
    signedInWithSettledLibrary();
    tmdb.movie = { ...movie, overview: SHORT_OVERVIEW };
    render(<MoviePageClient id="603" />);

    // The film's own words survive — this is the whole of BIN-735. A revert to
    // the either/or render drops this line.
    expect(screen.getByText(SHORT_OVERVIEW)).toBeTruthy();
    // …and the thin page still gains the extra prose it was written for.
    expect(screen.getByText(FLOOR_TAIL)).toBeTruthy();
  });

  it('does not add the generated sentence when the overview already carries the page', () => {
    signedInWithSettledLibrary();
    render(<MoviePageClient id="603" />);

    expect(screen.getByText(LONG_OVERVIEW)).toBeTruthy();
    // BIN-715: the shared 60-character threshold is what decides this. Swap
    // hasSubstantialText for a bare truthiness check and the floor stops
    // appearing for the short overview above; drop the check entirely and it
    // appears here, duplicating a synopsis that needed no help.
    expect(screen.queryByText(FLOOR_TAIL)).toBeNull();
  });

  it('falls back to the generated sentence alone when TMDB has no Swedish overview', () => {
    signedInWithSettledLibrary();
    // TMDB's sv-SE answer for an untranslated film is an empty string, not null.
    tmdb.movie = { ...movie, overview: '' };
    render(<MoviePageClient id="603" />);

    expect(screen.getByText(FLOOR_TAIL)).toBeTruthy();
  });
});

// BIN-814. The StatusButton is how a film actually enters the library — far more
// than the "Bevaka släpp" CTA next to it. It has to hand down BOTH provider answers,
// because the add stamps providersCheckedAt and a half-written pair would leave the
// advisor and all three money surfaces on the broad fallback. The two lists must
// also be genuinely different where TMDB says they are: rent-only offers belong in
// `providers` and must NOT appear in `subscriptionProviders`.
describe('MoviePageClient — the add control gets both provider answers (BIN-814)', () => {
  it('passes the broad list and the subscription subset, and they differ correctly', () => {
    statusButtonProps.last = null;
    signedInWithSettledLibrary();
    tmdb.movie = {
      ...movie,
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
    render(<MoviePageClient id="603" />);

    const props = statusButtonProps.last!;
    expect(props).not.toBeNull();
    expect(props.providers).toEqual(expect.arrayContaining([8, 76]));
    expect(props.subscriptionProviders).toEqual([8]);
    // The decisive assertion: Viaplay is reachable, but not on a subscription.
    expect(props.subscriptionProviders).not.toContain(76);
  });
});
