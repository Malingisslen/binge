import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useEffect } from 'react';

// --- Mocks -----------------------------------------------------------------
// trackEvent: fångar alla analytics-anrop.
const trackEvent = vi.fn();
vi.mock('@/lib/analytics', () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

// useAuth: styrs per test via en mutable referens.
const authState = { uid: 'u1' as string | null, user: { defaultVisibility: 'private' } as { defaultVisibility: string } | null };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

// migrateStatus: identitets-mappning (vi bryr oss inte om migration här).
vi.mock('@/lib/watchStatus.migration', () => ({
  migrateStatus: (status: string) => ({ status, dropped: false }),
}));

// buildStatusUpdate: spioneras (BIN-332) så updateStatus-testet kan verifiera
// vad contexten FÖR VIDARE från items-state (currentStatus/currentRewatchCount).
// Själva payload-logiken (dropped:false, rewatch-uppräkning) bor i
// watchlistWrites och testas där — här bryr vi oss bara om forwarding.
const buildStatusUpdate = vi.fn((..._args: unknown[]) => ({}) as Record<string, unknown>);
// Spy buildStatusUpdate but keep the REAL normalizeTags (BIN-164) so the
// updateTags test verifies genuine normalization, not a stub.
vi.mock('@/lib/watchlistWrites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/watchlistWrites')>();
  return {
    ...actual,
    buildStatusUpdate: (...args: unknown[]) => buildStatusUpdate(...args),
  };
});

// syncProgressToGroups: fire-and-forget grupp-synk som updateProgress kör via
// dynamisk import — mockad så vi kan verifiera att rätt status forwardas (BIN-332).
const syncProgressToGroups = vi.fn();
vi.mock('@/lib/firebase/groups', () => ({
  syncProgressToGroups: (...args: unknown[]) => syncProgressToGroups(...args),
}));

// firebase/utils toDate: passthrough.
vi.mock('@/lib/firebase/utils', () => ({
  toDate: (v: unknown) => v ?? null,
}));

// --- Firestore-mock --------------------------------------------------------
// lazySubscribe: kör attach() synkront och exponerar onSnapshot-callbacken
// så testet kan driva snapshot-sekvensen manuellt. BIN-164: contexten har nu
// TVÅ subscriptions (watchlist + watchlistTags) — routa på collection-path så
// `snapshotCallback` fortsatt driver watchlist-items (tags-callbacken separat).
let snapshotCallback: ((snap: { size: number; docs: { data: () => Record<string, unknown> }[] }) => void) | null = null;
let tagsSnapshotCallback: ((snap: { size: number; docs: { id: string; data: () => Record<string, unknown> }[] }) => void) | null = null;

const setDoc = vi.fn(async (..._args: unknown[]) => {});
const deleteDoc = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@/lib/firebase/db', () => ({
  lazySubscribe: (attach: (kit: unknown) => () => void) => {
    const kit = {
      db: {},
      collection: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
      onSnapshot: (
        ref: { _path?: string },
        cb: (snap: { size: number; docs: { data: () => Record<string, unknown> }[] }) => void,
      ) => {
        if ((ref?._path ?? '').endsWith('watchlistTags')) {
          tagsSnapshotCallback = cb as typeof tagsSnapshotCallback;
        } else {
          snapshotCallback = cb;
        }
        return () => {};
      },
    };
    return attach(kit);
  },
  fsdb: async () => ({
    db: {},
    // Path-kodande doc-ref så mutation-testerna kan pinna VILKEN doc som
    // skrivs/raderas (BIN-332), likt friends.test-harnessen.
    doc: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
    setDoc,
    deleteDoc,
    serverTimestamp: () => 'ts',
    Timestamp: { fromDate: (d: Date) => d },
  }),
}));

import { WatchlistProvider, useWatchlist } from './WatchlistContext';
import type { WatchlistItem, MediaType, WatchStatus } from '@/types';

// Hjälpare: en watchlist-doc med minimala fält som docToItem läser.
function doc(tmdbId: number, mediaType: MediaType = 'tv') {
  return {
    data: () => ({
      tmdbId,
      mediaType,
      status: mediaType === 'tv' ? 'mina' : 'sedd',
      title: `Title ${tmdbId}`,
    }),
  };
}

function snap(docs: { data: () => Record<string, unknown> }[]) {
  return { size: docs.length, docs };
}

// Rikare seed-doc för mutation-testerna: överlagra valfria docToItem-fält
// (status, rewatchCount, runtime, …) ovanpå förnuftiga TV-default (BIN-332).
function seedDoc(over: { tmdbId: number } & Record<string, unknown>) {
  return {
    data: () => ({ mediaType: 'tv', status: 'mina', title: `Title ${over.tmdbId}`, ...over }),
  };
}

// Testharness: exponerar mutatorerna så testet kan trigga dem. Refsen pekar
// alltid på den SENASTE closuren (de återskapas när items-state ändras), så ett
// anrop efter en seedad snapshot ser de seedade titlarna (BIN-332).
let addItemRef: ((item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'>) => Promise<void>) | null = null;
let updateStatusRef: ((tmdbId: number, status: WatchStatus, watchedAt?: Date) => Promise<void>) | null = null;
let updateProgressRef: ((tmdbId: number, season: number, episode: number) => Promise<void>) | null = null;
let setRuntimeRef: ((tmdbId: number, runtime: number | null) => Promise<void>) | null = null;
let removeItemRef: ((tmdbId: number) => Promise<void>) | null = null;
let updateTagsRef: ((tmdbId: number, tags: string[]) => Promise<void>) | null = null;
let updateRatingRef: ((tmdbId: number, rating: number | null) => Promise<void>) | null = null;
let refreshTmdbFieldsRef: ((tmdbId: number, fields: Record<string, unknown>) => Promise<void>) | null = null;

function Harness() {
  const wl = useWatchlist();
  useEffect(() => {
    addItemRef = wl.addItem;
    updateStatusRef = wl.updateStatus;
    updateProgressRef = wl.updateProgress;
    setRuntimeRef = wl.setRuntime;
    removeItemRef = wl.removeItem;
    updateTagsRef = wl.updateTags;
    updateRatingRef = wl.updateRating;
    refreshTmdbFieldsRef = wl.refreshTmdbFields as typeof refreshTmdbFieldsRef;
  }, [wl]);
  return <div>ready</div>;
}

function newTitle(tmdbId: number, mediaType: MediaType = 'tv'): Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'> {
  return {
    tmdbId,
    mediaType,
    status: mediaType === 'tv' ? 'mina' : 'sedd',
    rating: null,
    notes: null,
    title: `Title ${tmdbId}`,
    posterPath: null,
    releaseYear: null,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    providers: [],
    genreIds: [],
    tmdbStatus: null,
  } as Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'>;
}

function firstTitleAddedCount() {
  return trackEvent.mock.calls.filter(c => c[0] === 'first_title_added').length;
}

beforeEach(() => {
  trackEvent.mockClear();
  setDoc.mockClear();
  deleteDoc.mockClear();
  buildStatusUpdate.mockClear();
  syncProgressToGroups.mockClear();
  snapshotCallback = null;
  tagsSnapshotCallback = null;
  authState.uid = 'u1';
  authState.user = { defaultVisibility: 'private' };
});

describe('WatchlistContext — first_title_added gating (BIN-56 + BIN-38)', () => {
  it('(a) ny användare lägger till första titeln UNDER kall laddning → eventet fyras exakt en gång (tappas inte)', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    expect(screen.getByText('ready')).toBeTruthy();
    // Snapshoten har INTE landat än (kall laddning, loading===true, items===[]).
    expect(snapshotCallback).not.toBeNull();
    expect(firstTitleAddedCount()).toBe(0);

    // Användaren lägger till sin första titel FÖRE snapshoten.
    await act(async () => {
      await addItemRef!(newTitle(101));
    });
    // Beslutet skjuts upp — inget fyras vid add-tid under kall laddning.
    expect(firstTitleAddedCount()).toBe(0);
    expect(setDoc).toHaveBeenCalledTimes(1);

    // Första snapshoten landar nu och innehåller den tillagda titeln.
    await act(async () => {
      snapshotCallback!(snap([doc(101)]));
    });
    // Den uppskjutna första-titel-eventet fyras nu — exakt en gång.
    expect(firstTitleAddedCount()).toBe(1);
    expect(trackEvent).toHaveBeenCalledWith('first_title_added', { mediaType: 'tv' });
  });

  it('(b) återvändande användare med befintliga titlar lägger till en till → eventet fyras INTE', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    // Första snapshoten landar med befintliga titlar.
    await act(async () => {
      snapshotCallback!(snap([doc(1), doc(2), doc(3)]));
    });
    expect(firstTitleAddedCount()).toBe(0);

    // Lägger till ännu en titel.
    await act(async () => {
      await addItemRef!(newTitle(4));
    });
    // title_added_watchlist fyras men ALDRIG first_title_added (BIN-38).
    expect(firstTitleAddedCount()).toBe(0);
    expect(trackEvent).toHaveBeenCalledWith('title_added_watchlist', expect.anything());
  });

  it('(b2) återvändande användare lägger till UNDER kall laddning → eventet fyras INTE (BIN-38-racen)', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    // Add sker FÖRE snapshoten (kall laddning) — kan inte skiljas från ny
    // användare vid add-tid, så beslutet skjuts upp.
    await act(async () => {
      await addItemRef!(newTitle(5));
    });
    expect(firstTitleAddedCount()).toBe(0);

    // Första snapshoten landar och avslöjar ett FULLT bibliotek (>1 titel) →
    // återvändande användare. Den uppskjutna kandidaten ska INTE fyra.
    await act(async () => {
      snapshotCallback!(snap([doc(5), doc(6), doc(7)]));
    });
    expect(firstTitleAddedCount()).toBe(0);
  });

  it('(c) kall snapshot-laddning (utan add) fyrar inte eventet av sig själv', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    // Tomt bibliotek landar (ny användare som inte gjort något än).
    await act(async () => {
      snapshotCallback!(snap([]));
    });
    expect(firstTitleAddedCount()).toBe(0);

    // Sen full snapshot.
    await act(async () => {
      snapshotCallback!(snap([doc(8), doc(9)]));
    });
    expect(firstTitleAddedCount()).toBe(0);
  });

  it('ny användare lägger till EFTER att en tom snapshot settlat → fyras exakt en gång', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    // Tom snapshot settlar (vet säkert: biblioteket är tomt).
    await act(async () => {
      snapshotCallback!(snap([]));
    });
    expect(firstTitleAddedCount()).toBe(0);

    // Add efter settle → fyrar direkt.
    await act(async () => {
      await addItemRef!(newTitle(10, 'movie'));
    });
    expect(firstTitleAddedCount()).toBe(1);
    expect(trackEvent).toHaveBeenCalledWith('first_title_added', { mediaType: 'movie' });

    // En andra add ska INTE re-fyra.
    await act(async () => {
      await addItemRef!(newTitle(11));
    });
    expect(firstTitleAddedCount()).toBe(1);
  });

  it('(d) ny användare lägger till TVÅ titlar FÖRE första snapshoten → eventet fyras exakt en gång (BIN-110)', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    expect(snapshotCallback).not.toBeNull();
    expect(firstTitleAddedCount()).toBe(0);

    // Två adds UNDER kall laddning, FÖRE snapshoten landar — first add film,
    // sen tv (driver att payloaden = första addens mediaType, inte sista).
    await act(async () => {
      await addItemRef!(newTitle(201, 'movie'));
    });
    await act(async () => {
      await addItemRef!(newTitle(202, 'tv'));
    });
    // Beslutet är fortfarande uppskjutet — inget fyrat vid add-tid.
    expect(firstTitleAddedCount()).toBe(0);
    expect(setDoc).toHaveBeenCalledTimes(2);

    // Första snapshoten landar och innehåller BÅDA optimistiska skrivningarna
    // (size===2). Gamla `snap.size <= 1`-grinden hade tappat eventet här.
    await act(async () => {
      snapshotCallback!(snap([doc(201, 'movie'), doc(202, 'tv')]));
    });
    // Fyras exakt en gång, med FÖRSTA addens mediaType.
    expect(firstTitleAddedCount()).toBe(1);
    expect(trackEvent).toHaveBeenCalledWith('first_title_added', { mediaType: 'movie' });
  });

  it('(e) återvändande användare (1 befintlig titel) lägger till TVÅ under kall laddning → eventet fyras INTE (BIN-110/BIN-38)', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    expect(snapshotCallback).not.toBeNull();

    // Två adds FÖRE snapshoten.
    await act(async () => {
      await addItemRef!(newTitle(301));
    });
    await act(async () => {
      await addItemRef!(newTitle(302));
    });
    expect(firstTitleAddedCount()).toBe(0);

    // Första snapshoten landar med size===3: de två sessionens adds PLUS en
    // titel som redan fanns (303) → återvändande användare. snap.size(3) -
    // pendingCount(2) = 1 > 0 → fyra inte.
    await act(async () => {
      snapshotCallback!(snap([doc(301), doc(302), doc(303)]));
    });
    expect(firstTitleAddedCount()).toBe(0);
  });
});

describe('WatchlistContext — mutation paths (BIN-332)', () => {
  // Montera och seeda biblioteket via en första snapshot; efteråt pekar mutator-
  // refsen på closurer som ser de seedade titlarna.
  async function mountSeeded(docs: { data: () => Record<string, unknown> }[]) {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => {
      snapshotCallback!(snap(docs));
    });
  }

  it('updateStatus forwards the seeded currentStatus + currentRewatchCount to buildStatusUpdate', async () => {
    // En sedd film med 2 tidigare omtittningar. En stale-closure eller off-by-one
    // i rewatchCount-forwardingen vore osynlig utan denna assertion.
    await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'sedd', rewatchCount: 2 })]);

    await act(async () => {
      await updateStatusRef!(42, 'sedd');
    });

    expect(buildStatusUpdate).toHaveBeenCalledTimes(1);
    const [status, opts] = buildStatusUpdate.mock.calls[0] as [WatchStatus, Record<string, unknown>];
    expect(status).toBe('sedd');
    expect(opts.currentStatus).toBe('sedd');
    expect(opts.currentRewatchCount).toBe(2);
    // Skrivningen merge:as (aldrig overwrite) och status_changed loggas med rätt mediaType.
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(setDoc.mock.calls[0][2]).toEqual({ merge: true });
    expect(trackEvent).toHaveBeenCalledWith('status_changed', { mediaType: 'movie', status: 'sedd' });
  });

  it('setRuntime backfills runtime WITHOUT bumping updatedAt when runtime is unknown', async () => {
    await mountSeeded([seedDoc({ tmdbId: 7, runtime: null })]);

    await act(async () => {
      await setRuntimeRef!(7, 95);
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, opts] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>, unknown];
    expect(ref._path).toBe('users/u1/watchlist/7');
    expect(payload).toEqual({ runtime: 95 }); // ren denormalisering — INGEN updatedAt
    expect(opts).toEqual({ merge: true });
  });

  it('setRuntime skip-guard: no write when runtime is already known', async () => {
    await mountSeeded([seedDoc({ tmdbId: 7, runtime: 120 })]);
    await act(async () => {
      await setRuntimeRef!(7, 95);
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('setRuntime skip-guard: no write when the title is not in the library', async () => {
    await mountSeeded([]);
    await act(async () => {
      await setRuntimeRef!(999, 95);
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('updateProgress writes progress fields (never status) and forwards status to group-sync', async () => {
    await mountSeeded([seedDoc({ tmdbId: 5, mediaType: 'tv', status: 'mina' })]);

    await act(async () => {
      await updateProgressRef!(5, 2, 3);
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>];
    expect(ref._path).toBe('users/u1/watchlist/5');
    expect(payload.lastWatchedSeason).toBe(2);
    expect(payload.lastWatchedEpisode).toBe(3);
    // Progress ändrar ALDRIG status (regeln: status härleds, skrivs inte).
    expect(payload.status).toBeUndefined();

    // Fire-and-forget grupp-synk får seedad status, inte en gissning.
    await vi.waitFor(() => expect(syncProgressToGroups).toHaveBeenCalledTimes(1));
    expect(syncProgressToGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'u1', tmdbId: 5, lastWatchedSeason: 2, lastWatchedEpisode: 3, status: 'mina',
      }),
    );
  });

  it('removeItem deletes the watchlist doc AND its sibling tags doc (BIN-164)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9 })]);

    await act(async () => {
      await removeItemRef!(9);
    });

    // Both the watchlist doc and the owner-only tags doc are removed so tags
    // never orphan (their own collection isn't cascaded by the watchlist delete).
    expect(deleteDoc).toHaveBeenCalledTimes(2);
    expect((deleteDoc.mock.calls[0][0] as { _path: string })._path).toBe('users/u1/watchlist/9');
    expect((deleteDoc.mock.calls[1][0] as { _path: string })._path).toBe('users/u1/watchlistTags/9');
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('updateTags writes normalized tags to the owner-only tags doc (BIN-164)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9 })]);

    await act(async () => {
      // Duplicate + whitespace → normalizeTags collapses to one clean tag.
      await updateTagsRef!(9, ['  Mysrys ', 'mysrys']);
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>];
    expect(ref._path).toBe('users/u1/watchlistTags/9');
    expect(payload).toEqual({ tags: ['Mysrys'] });
  });

  it('updateTags deletes the tags doc when cleared to empty (BIN-164)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9 })]);

    await act(async () => {
      await updateTagsRef!(9, ['   ']); // normalizes to []
    });

    expect(setDoc).not.toHaveBeenCalled();
    expect(deleteDoc).toHaveBeenCalledTimes(1);
    expect((deleteDoc.mock.calls[0][0] as { _path: string })._path).toBe('users/u1/watchlistTags/9');
  });

  // BIN-349: ratedAt stamps rating-recency; the serverTimestamp mock returns 'ts'.
  it('updateRating stamps ratedAt when a rating is set (BIN-349)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9, rating: null })]);

    await act(async () => {
      await updateRatingRef!(9, 5);
    });

    const [ref, payload] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>];
    expect(ref._path).toBe('users/u1/watchlist/9');
    expect(payload.rating).toBe(5);
    expect(payload.ratedAt).toBe('ts'); // serverTimestamp sentinel
  });

  it('updateRating clears ratedAt to null when the rating is unset (BIN-349)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9, rating: 4 })]);

    await act(async () => {
      await updateRatingRef!(9, null);
    });

    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.rating).toBeNull();
    // A stale rating-recency must NOT survive a cleared rating.
    expect(payload.ratedAt).toBeNull();
  });

  it('addItem stamps ratedAt on a new/changed rating, NOT on a same-rating re-mark (BIN-349)', async () => {
    // Seed an already-rated in-library title (id 60, rating 5).
    await mountSeeded([seedDoc({ tmdbId: 60, mediaType: 'movie', status: 'sedd', rating: 5 })]);

    // Re-mark it via the addItem merge-write path (useMarkSeen/StatusButton/
    // QuickAddButton) carrying the UNCHANGED rating → ratedAt must NOT be written
    // (a blind stamp here re-bumped recency — the exact bug this fix closes).
    await act(async () => { await addItemRef!({ ...newTitle(60, 'movie'), rating: 5 }); });
    let payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect('ratedAt' in payload).toBe(false);

    // A brand-new pre-rated title (CSV import) → stamped.
    await act(async () => { await addItemRef!({ ...newTitle(61, 'movie'), rating: 5 }); });
    payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(payload.ratedAt).toBe('ts');

    // A re-mark that genuinely CHANGES the rating (5 → 4) → stamped.
    await act(async () => { await addItemRef!({ ...newTitle(60, 'movie'), rating: 4 }); });
    payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(payload.ratedAt).toBe('ts');

    // A brand-new unrated title → no ratedAt key at all.
    await act(async () => { await addItemRef!({ ...newTitle(62, 'movie'), rating: null }); });
    payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect('ratedAt' in payload).toBe(false);
  });
});

// BIN-508: hook-level coverage for the title-page lazy-refresh (refreshTmdbFields).
// The pure decision (planTmdbFieldsRefresh + the group-freshness predicates) is unit-
// tested in tmdbFieldsRefresh.test.ts; here we pin the CONTEXT wiring the pure layer
// can't see: the in-library guard, the echo-proof per-session dedupe, that the write
// is a merge that NEVER bumps updatedAt, and the BIN-468 independent gating (a stale
// providers group repairs even when the static stamp is fresh). We keep the REAL
// tmdbFieldsRefresh helpers (not mocked) so these tests exercise genuine gating.
describe('WatchlistContext — refreshTmdbFields lazy-refresh wiring (BIN-508/402/468)', () => {
  async function mountSeeded(docs: { data: () => Record<string, unknown> }[]) {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => {
      snapshotCallback!(snap(docs));
    });
  }

  it('repopulates the static TMDB block + freshness stamp for a swept-clean title (no updatedAt)', async () => {
    // No tmdbFieldsRefreshedAt on the doc → the sweep cleared it (or it was never
    // stamped) → the read-side must rewrite the denormalized block and re-stamp.
    await mountSeeded([seedDoc({ tmdbId: 77, title: 'Old', posterPath: null })]);

    await act(async () => {
      await refreshTmdbFieldsRef!(77, { title: 'Fresh', posterPath: '/p.jpg', genreIds: [18], tmdbStatus: 'Ended' });
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, opts] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>, unknown];
    expect(ref._path).toBe('users/u1/watchlist/77');
    expect(opts).toEqual({ merge: true });
    // Static block re-written + re-stamped from the detail the title page already had.
    expect(payload.title).toBe('Fresh');
    expect(payload.posterPath).toBe('/p.jpg');
    expect(payload.genreIds).toEqual([18]);
    expect(payload.tmdbStatus).toBe('Ended');
    expect(payload.tmdbFieldsRefreshedAt).toBe('ts'); // serverTimestamp sentinel
    // INVARIANT: this silent denormalisation must never reorder "senast ändrad".
    expect('updatedAt' in payload).toBe(false);
  });

  it('de-dupes per session: a second call for the same title writes nothing (echo-proof)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 78 })]);

    await act(async () => {
      await refreshTmdbFieldsRef!(78, { title: 'A' });
    });
    expect(setDoc).toHaveBeenCalledTimes(1);

    // The pending serverTimestamp reads back null on the echo snapshot, which would
    // re-trip the staleness gate — the session dedupe must suppress the re-fire.
    await act(async () => {
      await refreshTmdbFieldsRef!(78, { title: 'A' });
    });
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the title is not in the library (only library titles carry the stamp)', async () => {
    await mountSeeded([]);
    await act(async () => {
      await refreshTmdbFieldsRef!(999, { title: 'Ghost' });
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('does nothing when both the static stamp and the providers stamp are fresh', async () => {
    const now = new Date();
    await mountSeeded([seedDoc({ tmdbId: 79, tmdbFieldsRefreshedAt: now, providersCheckedAt: now })]);
    await act(async () => {
      await refreshTmdbFieldsRef!(79, { title: 'B', providers: [8] });
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('BIN-468: a stale providers group repairs even when the static stamp is fresh (independent gating)', async () => {
    // Static freshly stamped, but providersCheckedAt absent → the providers group is
    // stale and must repair on its own — WITHOUT rewriting the static block/stamp.
    await mountSeeded([seedDoc({ tmdbId: 80, tmdbFieldsRefreshedAt: new Date() })]);

    await act(async () => {
      await refreshTmdbFieldsRef!(80, { title: 'C', providers: [8, 9] });
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    // Only the providers group is written (fallback), never the fresh static block.
    expect(payload.providers).toEqual([8, 9]);
    expect(payload.providersCheckedAt).toBe('ts');
    expect('title' in payload).toBe(false);
    expect('tmdbFieldsRefreshedAt' in payload).toBe(false);
    expect('updatedAt' in payload).toBe(false);
  });

  it('swallows a Firestore failure without throwing (best-effort, next view retries)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 81 })]);
    setDoc.mockRejectedValueOnce(new Error('permission-denied'));

    // Must resolve, not reject — a rejected best-effort write would surface as an
    // unhandled promise rejection (Sentry noise), the setRuntime-pattern this follows.
    await act(async () => {
      await expect(refreshTmdbFieldsRef!(81, { title: 'D' })).resolves.toBeUndefined();
    });
  });
});
