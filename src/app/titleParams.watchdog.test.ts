// BIN-815 — the build hung 4 of 6 runs on 2026-08-07, always to the build
// step timeout, always with `Collecting page data using 3 workers ...` as the last
// line. That phase is `generateStaticParams`, and three routes make network
// calls in it: movie/[id] and tv/[id] (1000 TMDB list fetches each) and
// person/[id] (~2100 via collectPersonIds). The other five are static lists.
//
// Round 2 of this ticket instrumented the sitemap instead, which runs in a
// LATER phase; three reviewers caught it. This file exists so that mistake
// cannot be made silently again: if any of the three stops registering its
// fetches, the heartbeat reports `inflight=0` straight through a hang and the
// next investigation is pointed the wrong way.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getPopularMovies = vi.fn();
const getTopRatedMovies = vi.fn();
const getPopularTV = vi.fn();
const getTopRatedTV = vi.fn();
const getPerson = vi.fn();

// The page modules import their client components, which reach Firebase. Only
// generateStaticParams is under test here, so stub the render side out.
vi.mock('@/components/pages/MoviePageClient', () => ({ default: () => null }));
vi.mock('@/components/pages/TVShowPageClient', () => ({ default: () => null }));
vi.mock('@/components/pages/PersonPageClient', () => ({ default: () => null }));

vi.mock('@/lib/tmdb/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tmdb/client')>();
  return {
    ...actual,
    getPopularMovies: (...a: unknown[]) => getPopularMovies(...a),
    getTopRatedMovies: (...a: unknown[]) => getTopRatedMovies(...a),
    getPopularTV: (...a: unknown[]) => getPopularTV(...a),
    getTopRatedTV: (...a: unknown[]) => getTopRatedTV(...a),
    getPerson: (...a: unknown[]) => getPerson(...a),
  };
});

import { __resetBuildFetchState, __setBuildFetchLogger } from '@/lib/tmdb/buildFetch';
import { generateStaticParams as movieParams } from './movie/[id]/page';
import { generateStaticParams as tvParams } from './tv/[id]/page';
import { generateStaticParams as personParams } from './person/[id]/page';

const ROUTES = [
  {
    name: 'movie/[id]',
    run: movieParams,
    mocks: [getPopularMovies, getTopRatedMovies],
    label: 'params:popular-movies/p1',
    second: 'params:top-movies/p1',
    stuckAfterMs: 60_000,
  },
  {
    name: 'tv/[id]',
    run: tvParams,
    mocks: [getPopularTV, getTopRatedTV],
    label: 'params:popular-tv/p1',
    second: 'params:top-tv/p1',
    stuckAfterMs: 60_000,
  },
  {
    // The biggest caller in this phase: 100 list pages + up to 2000 detail
    // fetches inside collectPersonIds. Registered as one unit — the hang we
    // need to see is "this whole pipeline never returned".
    name: 'person/[id]',
    run: personParams,
    mocks: [getPopularMovies],
    label: 'params:person-ids',
    second: null,
    // One label over ~2100 calls has no 20s ceiling of its own, so it carries a
    // deliberately generous stuck threshold — otherwise a healthy build reports
    // STUCK every tick and the line stops meaning anything.
    stuckAfterMs: 300_000,
  },
] as const;

describe.each(ROUTES)('$name generateStaticParams — build watchdog (BIN-815)', (route) => {
  let lines: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    __resetBuildFetchState();
    lines = [];
    __setBuildFetchLogger((m) => lines.push(m));
    for (const m of route.mocks) m.mockReset();
  });

  afterEach(() => {
    __resetBuildFetchState();
    vi.useRealTimers();
  });

  it('startar pulsen i den fas som hänger, innan något anrop hunnit svara', async () => {
    // Never-resolving fetchers: this IS the hang, reproduced.
    for (const m of route.mocks) m.mockImplementation(() => new Promise(() => {}));
    void route.run().catch(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    const pulse = lines.find((l) => l.startsWith('[build-fetch] pid='));
    expect(pulse).toBeDefined();
    // Not inflight=0 — the whole point is that a hang here is visible AS a hang.
    expect(pulse).not.toContain('inflight=0');
  });

  it('namnger den list-hämtning som aldrig återvänder', async () => {
    for (const m of route.mocks) m.mockImplementation(() => new Promise(() => {}));
    void route.run().catch(() => {});
    await vi.advanceTimersByTimeAsync(route.stuckAfterMs);
    const stuck = lines.filter((l) => l.includes('STUCK'));
    expect(stuck.length).toBeGreaterThan(0);
    expect(stuck.some((l) => l.includes(route.label))).toBe(true);
  });

  // Each label is a string its own call site re-derives, so one probe does not
  // cover the other. The routes with two collectIds calls get both pinned.
  // Only the SECOND fetcher hangs. Without this the 5-entry cap is filled by the
  // first collectIds call and the second label could be anything at all.
  it.runIf(route.second !== null)('namnger även den andra list-hämtaren', async () => {
    const [first, second] = route.mocks;
    first.mockResolvedValue({ results: [{ id: 1, title: 'x', name: 'x' }] });
    second?.mockImplementation(() => new Promise(() => {}));
    void route.run().catch(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lines.some((l) => l.includes(route.second as string))).toBe(true);
  });

  // The person route wraps ~2100 calls in ONE label, which has no 20s ceiling of
  // its own — a healthy run legitimately takes ~40s. Without its aggregate flag
  // every green build would print STUCK every tick until the line meant nothing.
  // This pins the flag at the CALL SITE; the helper's branch is pinned separately
  // in buildFetch.test.ts.
  it.runIf(route.second === null)('en frisk aggregat-körning rapporteras inte som STUCK', async () => {
    for (const m of route.mocks) m.mockImplementation(() => new Promise(() => {}));
    void route.run().catch(() => {});
    await vi.advanceTimersByTimeAsync(90_000);
    expect(lines.some((l) => l.startsWith('[build-fetch] pid='))).toBe(true);
    expect(lines.some((l) => l.includes('STUCK'))).toBe(false);
  });

  it.runIf(route.second !== null)('rapporterar de äldsta och räknar resten — inte 1000 rader per puls', async () => {
    for (const m of route.mocks) m.mockImplementation(() => new Promise(() => {}));
    void route.run().catch(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    const perTick = lines.filter((l) => l.includes('STUCK')).length;
    // 1000 queued calls behind an 8-slot semaphore would otherwise all read as
    // stuck; the cap is what keeps the signal readable.
    expect(perTick).toBeLessThanOrEqual(10);
    expect(lines.some((l) => /och \d+ till$/.test(l))).toBe(true);
  });
});
