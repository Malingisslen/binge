// src/components/onboarding/OnboardingFlow.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { OnboardingFlow } from './OnboardingFlow';
import type { TMDBSearchResult, WatchlistItem } from '@/types';
import { DELETION_IN_PROGRESS, DELETION_IN_PROGRESS_MESSAGE } from '@/lib/deletionInProgressError';

// Three defects, one flow (BIN-664 / BIN-659 / BIN-669):
//
//  * the "Tillagd" check compared tmdbId only, and TMDB numbers films and
//    series in separate sequences — so a film could mask a series with the
//    same id and there was no way to add it;
//  * every write in the flow (providers, first title, the completion stamp)
//    rejected unhandled, so a failed save was indistinguishable from a missed
//    tap; and
//  * sign-in remembers where the visitor was, but routes brand-new accounts
//    through onboarding — which never handed the path back.

const auth = vi.hoisted(() => ({
  uid: 'u1' as string | null,
  user: { uid: 'u1', myProviders: [] as number[] } as Record<string, unknown> | null,
  updateProviders: vi.fn<(providers: number[]) => Promise<void>>(async () => {}),
}));
const watchlist = vi.hoisted(() => ({
  items: [] as WatchlistItem[],
  upsertTitle: vi.fn<(payload: { tmdbId: number; mediaType: string }) => Promise<void>>(async () => {}),
  // A GETTER, mirroring the provider's own derivation — a hardcoded
  // `libraryKnown` would let these tests assert a state production can't reach.
  snapshotSettled: true,
  listenerFailed: false,
  get libraryKnown(): boolean { return this.snapshotSettled && !this.listenerFailed; },
  retryListener: vi.fn(),
}));
const search = vi.hoisted(() => ({
  data: null as { results: TMDBSearchResult[] } | null,
  isLoading: false,
}));
const setDoc = vi.hoisted(() => vi.fn(async () => {}));
const toast = vi.hoisted(() => vi.fn());
// ONE router object, hoisted — a per-call factory would make every assertion
// about `push` vacuous (lesson from BIN-645).
const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useTMDB', () => ({ useSearch: () => search }));
// Identity: the 250ms debounce is not what these tests are about.
vi.mock('@/hooks/useDebouncedValue', () => ({ useDebouncedValue: <T,>(v: T) => v }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
vi.mock('@/lib/firebase/db', () => ({
  fsdb: async () => ({ db: {}, doc: vi.fn(), setDoc, serverTimestamp: vi.fn() }),
}));

const NEXT_KEY = 'binge:nextAfterLogin';

/** id 1399 is Game of Thrones as a SERIES. The same number is also a film. */
const gotSeries = {
  id: 1399,
  media_type: 'tv',
  name: 'Game of Thrones',
  poster_path: null,
  genre_ids: [18],
  first_air_date: '2011-04-17',
} as TMDBSearchResult;

const item = (tmdbId: number, mediaType: 'movie' | 'tv') =>
  ({ tmdbId, mediaType, status: 'vill_se', title: 'Något' }) as WatchlistItem;

/** Step 1 → 4. Needs one tracked title so step 3's own "Hoppa över" is absent. */
async function goToLastStep() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });
  expect(screen.getByRole('heading', { name: 'Klar.' })).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  auth.uid = 'u1';
  auth.user = { uid: 'u1', myProviders: [] };
  auth.updateProviders.mockResolvedValue(undefined);
  watchlist.items = [];
  watchlist.upsertTitle.mockResolvedValue(undefined);
  watchlist.snapshotSettled = true;
  watchlist.listenerFailed = false;
  search.data = null;
  search.isLoading = false;
  setDoc.mockResolvedValue(undefined);
  // Silence the deliberate console.error in the failure paths.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('BIN-664 — the duplicate check is (tmdbId, mediaType), not tmdbId', () => {
  beforeEach(() => { search.data = { results: [gotSeries] }; });

  it('still offers a series whose id is already tracked as a FILM', async () => {
    watchlist.items = [item(1399, 'movie')];
    render(<OnboardingFlow />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });

    // The whole defect: the film shadowed the series and left no way to add it.
    expect(screen.queryByText('Tillagd')).not.toBeInTheDocument();
    const follow = screen.getByRole('button', { name: 'Följ' });

    await act(async () => { fireEvent.click(follow); });
    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1);
    expect(watchlist.upsertTitle.mock.calls[0][0]).toMatchObject({ tmdbId: 1399, mediaType: 'tv' });
  });

  it('still marks a genuine duplicate as Tillagd — same id AND same type', async () => {
    // The control. Without it a mutant that never matches anything would pass
    // the test above.
    watchlist.items = [item(1399, 'tv')];
    render(<OnboardingFlow />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });

    expect(screen.getByText('Tillagd')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Följ' })).not.toBeInTheDocument();
  });
});

describe('BIN-659 — a failed write is visible and retry-able', () => {
  it('says so when saving the providers fails, and stays on the step', async () => {
    auth.updateProviders.mockRejectedValueOnce(new Error('offline'));
    render(<OnboardingFlow />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/Kunde inte spara dina tjänster/);
    // Not advanced — the step 2 heading is still the one on screen.
    expect(screen.getByRole('heading', { name: 'Vilka tjänster har du?' })).toBeInTheDocument();

    // Same button is the retry, and a success clears the message.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lägg till din första titel' })).toBeInTheDocument();
  });

  it('says so when adding the first title fails, and the row retries', async () => {
    search.data = { results: [gotSeries] };
    watchlist.upsertTitle.mockRejectedValueOnce(new Error('offline'));
    render(<OnboardingFlow />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Följ' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/Kunde inte lägga till titeln/);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Följ' })); });
    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not navigate away when the completion stamp fails', async () => {
    watchlist.items = [item(1399, 'tv')];
    setDoc.mockRejectedValueOnce(new Error('offline'));
    render(<OnboardingFlow />);
    await goToLastStep();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Klar/ })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/Kunde inte spara att du är klar/);
    // The actual bug was advancing past a write that never landed.
    expect(push).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Klar/ })); });
    expect(push).toHaveBeenCalledWith('/');
  });

  it('surfaces a failed stamp from "Hoppa över" too', async () => {
    watchlist.items = [item(1399, 'tv')];
    setDoc.mockRejectedValueOnce(new Error('offline'));
    render(<OnboardingFlow />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hoppa över' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/Kunde inte spara att du är klar/);
    expect(push).not.toHaveBeenCalled();
  });

  it('the completion error does NOT follow the visitor to the next step', async () => {
    // "Hoppa över" reaches `finish` from every step, and its error renders below
    // the card rather than inside it — so without a reset on step change, a
    // failed skip on step 1 leaves "Kunde inte spara att du är klar" standing
    // while the visitor works through steps 2-4 for entirely unrelated reasons.
    // That is the opposite of what BIN-659 is for: it would report a failure
    // that is no longer happening.
    watchlist.items = [item(1399, 'tv')];
    setDoc.mockRejectedValueOnce(new Error('offline'));
    render(<OnboardingFlow />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hoppa över' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/Kunde inte spara att du är klar/);

    // Moving on is unrelated to the skip that failed.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// BIN-643. This step used to be deliberately ungated, on the argument that a
// brand-new account has no library to overwrite. The overwrite is not the only
// loss: on a dead listener a title marked "Sedd" here lands with NO watchedAt
// (upsertTitle suppresses the stamp when it cannot tell a new add from a re-mark),
// and that half never self-heals. The flow is also reachable for any account
// whose onboardingCompletedAt is unset, library and all.
describe('BIN-643 — the first add waits for the library, and never traps anyone', () => {
  // A tracked title unrelated to the search result, so step 3's own "Hoppa över"
  // stays out of the way (canContinue is true) and the row still offers "Följ".
  const other = () => [item(603, 'movie')];

  async function goToStepThree() {
    render(<OnboardingFlow />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });
    expect(screen.getByRole('heading', { name: 'Lägg till din första titel' })).toBeInTheDocument();
  }

  beforeEach(() => {
    search.data = { results: [gotSeries] };
    watchlist.items = other();
  });

  it('holds the add while the first snapshot is in flight', async () => {
    watchlist.snapshotSettled = false;
    await goToStepThree();

    const follow = screen.getByRole('button', { name: 'Följ' });
    expect(follow).toBeDisabled();
    await act(async () => { fireEvent.click(follow); });
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(screen.getByText(/Läser in ditt bibliotek/)).toBeInTheDocument();
  });

  it('explains a dead listener and offers a retry', async () => {
    watchlist.listenerFailed = true;
    await goToStepThree();

    expect(screen.getByRole('button', { name: 'Följ' })).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Följ' })); });
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();

    expect(screen.getByRole('alert')).toHaveTextContent(/Vi når inte ditt bibliotek/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Försök igen' })); });
    expect(watchlist.retryListener).toHaveBeenCalledTimes(1);
  });

  it('lets someone leave onboarding even when the listener never recovers', async () => {
    // The reason the gate is safe to add here at all: a hold that never ends
    // must not be a locked door. "Hoppa över" completes the account and routes.
    watchlist.listenerFailed = true;
    await goToStepThree();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hoppa över' })); });
    expect(push).toHaveBeenCalledWith('/');
  });

  it('adds normally once the library is known — the control', async () => {
    await goToStepThree();

    const follow = screen.getByRole('button', { name: 'Följ' });
    expect(follow).not.toBeDisabled();
    await act(async () => { fireEvent.click(follow); });
    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('BIN-669 — the remembered path survives onboarding', () => {
  beforeEach(() => { watchlist.items = [item(1399, 'tv')]; });

  it('lands a finished new account back where it started', async () => {
    window.sessionStorage.setItem(NEXT_KEY, '/tv/1399/');
    render(<OnboardingFlow />);
    await goToLastStep();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Klar/ })); });
    expect(push).toHaveBeenCalledWith('/tv/1399/');
    // Single-use: left behind, it would aim the next sign-in in this tab at a
    // page that is by then stale.
    expect(window.sessionStorage.getItem(NEXT_KEY)).toBeNull();
  });

  it('lands them back there after "Hoppa över" as well', async () => {
    window.sessionStorage.setItem(NEXT_KEY, '/movie/603/');
    render(<OnboardingFlow />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hoppa över' })); });
    expect(push).toHaveBeenCalledWith('/movie/603/');
  });

  it('lets the Kalibrera CTA win — and still consumes the path', async () => {
    window.sessionStorage.setItem(NEXT_KEY, '/tv/1399/');
    render(<OnboardingFlow />);
    await goToLastStep();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Kalibrera smak/ })); });
    expect(push).toHaveBeenCalledWith('/kalibrera/');
    expect(window.sessionStorage.getItem(NEXT_KEY)).toBeNull();
  });

  it('falls back to the home page when nothing was remembered', async () => {
    render(<OnboardingFlow />);
    await goToLastStep();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Klar/ })); });
    expect(push).toHaveBeenCalledWith('/');
  });

  it('refuses a planted path that points back into the sign-in journey', async () => {
    // Anything on our own origin can write sessionStorage; takeNextPath is what
    // stops a planted '/login/' from bouncing a signed-in visitor to the form.
    window.sessionStorage.setItem(NEXT_KEY, '/login/');
    render(<OnboardingFlow />);
    await goToLastStep();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Klar/ })); });
    expect(push).toHaveBeenCalledWith('/');
  });
});

describe('OnboardingFlow — a refused add is not offered a retry (BIN-1038)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.uid = 'u1';
    auth.user = { uid: 'u1', myProviders: [] };
    watchlist.items = [];
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = false;
    watchlist.upsertTitle.mockResolvedValue(undefined);
    search.data = { results: [gotSeries] };
    window.sessionStorage.clear();
  });

  it('says the account is being deleted instead of "kontrollera anslutningen och försök igen"', async () => {
    // The generic `SaveError` this step already had is RETRY advice, and a retry can never
    // work here: the deletion marker does not clear on its own, so every attempt is refused
    // identically. Same reasoning #19 Customer Support used to block BIN-1032's generic
    // message on `ReconsentGate` — the app's screens must not disagree about what a refused
    // write means.
    watchlist.upsertTitle.mockRejectedValueOnce(new Error(`${DELETION_IN_PROGRESS}: refused`));
    render(<OnboardingFlow />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Följ' })); });

    expect(toast).toHaveBeenCalledWith(DELETION_IN_PROGRESS_MESSAGE);
    // The retry banner must NOT appear — that is the whole finding.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('control — an ordinary failure still gets the retry banner, not the deletion message', async () => {
    // Without this the row above passes on a catch that reports EVERY failure as a deletion,
    // which would take the working retry away from the case it was built for (BIN-659).
    watchlist.upsertTitle.mockRejectedValueOnce(new Error('offline'));
    render(<OnboardingFlow />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Följ' })); });

    expect(screen.getByRole('alert')).toHaveTextContent(/Kunde inte lägga till titeln/);
    expect(toast).not.toHaveBeenCalledWith(DELETION_IN_PROGRESS_MESSAGE);
  });
});

describe('OnboardingFlow — the PROFILE write path says the same thing (BIN-1047)', () => {
  // BIN-1038 fixed ONE of this file’s three catches for the same refusal — the watchlist add.
  // The other two reach a different guard (`assertProfileWritable`, via `mergeUserDoc`) and still
  // rendered `SaveError`, whose established meaning in this file is "the same button is the
  // retry". The deletion marker never clears, so that advice is false on every retry. The
  // message is deliberately guard-agnostic, so no new wording is introduced here.
  beforeEach(() => {
    watchlist.items = [item(1399, 'tv')];
  });

  it('finish() — a refused completion stamp says the account is being deleted', async () => {
    setDoc.mockRejectedValueOnce(new Error(`${DELETION_IN_PROGRESS}: refused`));
    render(<OnboardingFlow />);
    await goToLastStep();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Klar/ })); });

    expect(toast).toHaveBeenCalledWith(DELETION_IN_PROGRESS_MESSAGE);
    // The retry banner must not appear at all — a correct message inside a banner that still
    // invites a retry contradicts itself.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Still not navigated: the stamp did not land.
    expect(push).not.toHaveBeenCalled();
  });

  it('finish() control — an ordinary failure still gets the retry banner', async () => {
    setDoc.mockRejectedValueOnce(new Error('offline'));
    render(<OnboardingFlow />);
    await goToLastStep();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Klar/ })); });

    expect(screen.getByRole('alert')).toHaveTextContent(/Kunde inte spara att du är klar/);
    expect(toast).not.toHaveBeenCalledWith(DELETION_IN_PROGRESS_MESSAGE);
  });

  it('"Hoppa över" reaches the same catch, and says the same thing', async () => {
    setDoc.mockRejectedValueOnce(new Error(`${DELETION_IN_PROGRESS}: refused`));
    render(<OnboardingFlow />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hoppa över' })); });

    expect(toast).toHaveBeenCalledWith(DELETION_IN_PROGRESS_MESSAGE);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('StepProviders.save() — a refused provider save says the account is being deleted', async () => {
    auth.updateProviders.mockRejectedValueOnce(new Error(`${DELETION_IN_PROGRESS}: refused`));
    render(<OnboardingFlow />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });

    expect(toast).toHaveBeenCalledWith(DELETION_IN_PROGRESS_MESSAGE);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Still on step 2 — the save did not land, so the step must not advance.
    expect(screen.getByRole('heading', { name: 'Vilka tjänster har du?' })).toBeInTheDocument();
  });

  it('StepProviders.save() control — an ordinary failure still gets the retry banner', async () => {
    auth.updateProviders.mockRejectedValueOnce(new Error('offline'));
    render(<OnboardingFlow />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Börja/ })); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nästa/ })); });

    expect(screen.getByRole('alert')).toHaveTextContent(/Kunde inte spara dina tjänster/);
    expect(toast).not.toHaveBeenCalledWith(DELETION_IN_PROGRESS_MESSAGE);
  });
});
