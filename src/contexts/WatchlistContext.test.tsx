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

// buildStatusUpdate: irrelevant för dessa tester.
vi.mock('@/lib/watchlistWrites', () => ({
  buildStatusUpdate: () => ({}),
}));

// firebase/utils toDate: passthrough.
vi.mock('@/lib/firebase/utils', () => ({
  toDate: (v: unknown) => v ?? null,
}));

// --- Firestore-mock --------------------------------------------------------
// lazySubscribe: kör attach() synkront och exponerar onSnapshot-callbacken
// så testet kan driva snapshot-sekvensen manuellt.
let snapshotCallback: ((snap: { size: number; docs: { data: () => Record<string, unknown> }[] }) => void) | null = null;

const setDoc = vi.fn(async () => {});

vi.mock('@/lib/firebase/db', () => ({
  lazySubscribe: (attach: (kit: unknown) => () => void) => {
    const kit = {
      db: {},
      collection: () => ({}),
      onSnapshot: (
        _ref: unknown,
        cb: (snap: { size: number; docs: { data: () => Record<string, unknown> }[] }) => void,
      ) => {
        snapshotCallback = cb;
        return () => {};
      },
    };
    return attach(kit);
  },
  fsdb: async () => ({
    db: {},
    doc: () => ({}),
    setDoc,
    serverTimestamp: () => 'ts',
  }),
}));

import { WatchlistProvider, useWatchlist } from './WatchlistContext';
import type { WatchlistItem, MediaType } from '@/types';

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

function snap(docs: ReturnType<typeof doc>[]) {
  return { size: docs.length, docs };
}

// Testharness: exponerar addItem så testet kan trigga en add.
let addItemRef: ((item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'>) => Promise<void>) | null = null;

function Harness() {
  const { addItem } = useWatchlist();
  useEffect(() => {
    addItemRef = addItem;
  }, [addItem]);
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
  snapshotCallback = null;
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
