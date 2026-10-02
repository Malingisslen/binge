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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const getPopularMovies = vi.fn();
const getTopRatedMovies = vi.fn();
const getPopularTV = vi.fn();
const getTopRatedTV = vi.fn();
const getPerson = vi.fn();
const getMovie = vi.fn();

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
    getMovie: (...a: unknown[]) => getMovie(...a),
  };
});

import { __resetBuildFetchState, __setBuildFetchLogger, buildCallStats } from '@/lib/tmdb/buildFetch';
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
    // fetches inside collectPersonIds. Since BIN-1421 each of those calls is
    // registered on its own, so the one that never returns is named by its page.
    name: 'person/[id]',
    run: personParams,
    mocks: [getPopularMovies],
    label: 'params:person-popular/p1',
    second: null,
    stuckAfterMs: 60_000,
  },
] as const;

describe.each(ROUTES)('$name generateStaticParams — build watchdog (BIN-815)', (route) => {
  let lines: string[];
  let cacheDir: string;

  beforeEach(() => {
    // BIN-823: `generateStaticParams` gör inte längre några list-anrop om det
    // finns ett färskt urvalsmanifest — det är hela poängen med den ändringen.
    // Utan en egen cache-katalog läser den här filen repots RIKTIGA
    // .tmdb-cache, hoppar över härledningen, och varje puls-assertion nedan
    // får ingenting att observera (10 av 11 föll så här lokalt). Egen tom
    // katalog + refresh-regimen tvingar fram den härledning testet bevakar.
    cacheDir = mkdtempSync(join(tmpdir(), 'watchdog-params-test-'));
    process.env.TMDB_CACHE_DIR = cacheDir;
    process.env.TMDB_SELECTION_REFRESH = '1';
    // Härledningen ger inget här (mockarna hänger/failar med flit), och
    // täckningsgolvet ska inte vara det som fäller ett vakthundstest.
    process.env.SELECTION_ALLOW_THIN = '1';
    vi.useFakeTimers();
    __resetBuildFetchState();
    lines = [];
    __setBuildFetchLogger((m) => lines.push(m));
    for (const m of route.mocks) m.mockReset();
    getMovie.mockReset();
    // resolveSelection writes its [selection] lines straight to stderr; keep them
    // out of the test run's output, where they would read as GitHub annotations.
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetBuildFetchState();
    vi.useRealTimers();
    rmSync(cacheDir, { recursive: true, force: true });
    delete process.env.TMDB_CACHE_DIR;
    delete process.env.TMDB_SELECTION_REFRESH;
    delete process.env.SELECTION_ALLOW_THIN;
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
  // Healthy and slow: every call answers within its own abort, but the two phases
  // together outlast the single-call threshold. Only the aggregate flag keeps the
  // whole-pipeline label from being reported, or abandoned, at 30 s.
  it.runIf(route.second === null)('en frisk aggregat-körning rapporteras inte som STUCK', async () => {
    const later = <T,>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), 25_000));
    getPopularMovies.mockImplementation(() => later({ results: [{ id: 7, title: 'Abc' }] }));
    getMovie.mockImplementation(() => later({ id: 7, credits: { cast: [{ id: 70, name: 'Abc' }] } }));
    let ids = null as { id: string }[] | null;
    void route.run().then((r) => { ids = r as { id: string }[]; }, () => {});
    await vi.advanceTimersByTimeAsync(90_000);
    expect((ids ?? []).map((x) => x.id)).toContain('70');
    expect(lines.some((l) => l.startsWith('[build-fetch] pid='))).toBe(true);
    expect(lines.some((l) => l.includes('STUCK'))).toBe(false);
  });

  // BIN-1420: a single list page that never answers must not hold the whole
  // derivation. On 2026-09-07 `params:popular-movies/p281` did exactly that for
  // 150 minutes. The page is abandoned; every other page still counts.
  it.runIf(route.second !== null)('en sida som aldrig svarar överges, och resten av urvalet blir klart', async () => {
    const [first, second] = route.mocks;
    // The two lists get ids that cannot overlap, so a surviving page of the
    // HANGING list is only ever counted by that list's own results.
    const page = (base: number, p: number) => ({ results: [{ id: base + p, title: 'Abc', name: 'Abc' }] });
    first.mockImplementation((p: number) => (p === 1 ? new Promise(() => {}) : Promise.resolve(page(1000, p))));
    second?.mockImplementation((p: number) => Promise.resolve(page(5000, p)));
    let ids = null as { id: string }[] | null;
    void route.run().then((r) => { ids = r as { id: string }[]; }, () => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ids).not.toBeNull();
    const got = (ids ?? []).map((x) => x.id);
    expect(got).toContain('1002');
    expect(got).toContain('5001');
    expect(got).not.toContain('1001');
    expect(lines.some((l) => l.includes('ABANDONED') && l.includes(route.label))).toBe(true);
    // BIN-1423: the call site files the abandoned page under its own type.
    expect(buildCallStats(route.name === 'movie/[id]' ? 'movie' : 'tv').abandonedLabels).toEqual([route.label]);
  });

  it.runIf(route.second !== null)('rapporterar de äldsta och räknar resten — inte 1000 rader per puls', async () => {
    for (const m of route.mocks) m.mockImplementation(() => new Promise(() => {}));
    void route.run().catch(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    const perTick = lines.filter((l) => l.includes('STUCK')).length;
    expect(perTick).toBeLessThanOrEqual(10);
    expect(lines.some((l) => /och \d+ till$/.test(l))).toBe(true);
  });
});
