// BIN-815 — the build hung 4 of 6 runs on 2026-08-07, always to the build
// step timeout, always with `Collecting page data using 3 workers ...` as the last
// line. That phase is `generateStaticParams`. Since ADR 0024 the routes that
// make network calls in it are movie/[id] and tv/[id] (their /discover pages);
// person/[id] builds a static list. Derive the set with
// `git grep -ln "trackBuildCall" -- src/app`.
//
// Round 2 of this ticket instrumented the sitemap instead, which runs in a
// LATER phase; three reviewers caught it. This file exists so that mistake
// cannot be made silently again: if either route stops registering its
// fetches, the heartbeat reports `inflight=0` straight through a hang and the
// next investigation is pointed the wrong way.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const discoverMovies = vi.fn();
const discoverTV = vi.fn();

// The page modules import their client components, which reach Firebase. Only
// generateStaticParams is under test here, so stub the render side out.
vi.mock('@/components/pages/MoviePageClient', () => ({ default: () => null }));
vi.mock('@/components/pages/TVShowPageClient', () => ({ default: () => null }));

vi.mock('@/lib/tmdb/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tmdb/client')>();
  return {
    ...actual,
    discoverMovies: (...a: unknown[]) => discoverMovies(...a),
    discoverTV: (...a: unknown[]) => discoverTV(...a),
  };
});

import { __resetBuildFetchState, __setBuildFetchLogger, buildCallStats } from '@/lib/tmdb/buildFetch';
import { generateStaticParams as movieParams } from './movie/[id]/page';
import { generateStaticParams as tvParams } from './tv/[id]/page';

const ROUTES = [
  {
    name: 'movie/[id]',
    run: movieParams,
    discover: discoverMovies,
    label: 'params:core-movies/p1',
    type: 'movie' as const,
  },
  {
    name: 'tv/[id]',
    run: tvParams,
    discover: discoverTV,
    label: 'params:core-tv/p1',
    type: 'tv' as const,
  },
];

const pageOf = (params: Record<string, string>) => Number(params.page);

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
    route.discover.mockReset();
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
    route.discover.mockImplementation(() => new Promise(() => {}));
    void route.run().catch(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    const pulse = lines.find((l) => l.startsWith('[build-fetch] pid='));
    expect(pulse).toBeDefined();
    // Not inflight=0 — the whole point is that a hang here is visible AS a hang.
    expect(pulse).not.toContain('inflight=0');
  });

  it('namnger den list-hämtning som aldrig återvänder', async () => {
    route.discover.mockImplementation(() => new Promise(() => {}));
    void route.run().catch(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    const stuck = lines.filter((l) => l.includes('STUCK'));
    expect(stuck.length).toBeGreaterThan(0);
    expect(stuck.some((l) => l.includes(route.label))).toBe(true);
  });

  // BIN-1420: a single list page that never answers must not hold the whole
  // derivation. On 2026-09-07 `params:popular-movies/p281` did exactly that for
  // 150 minutes. The page is abandoned; every other page still counts.
  it('en sida som aldrig svarar överges, och resten av urvalet blir klart', async () => {
    const page = (p: number) => ({ results: [{ id: 1000 + p, title: 'Abc', name: 'Abc' }] });
    route.discover.mockImplementation((params: Record<string, string>) =>
      pageOf(params) === 1 ? new Promise(() => {}) : Promise.resolve(page(pageOf(params))),
    );
    let ids = null as { id: string }[] | null;
    void route.run().then((r) => { ids = r as { id: string }[]; }, () => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ids).not.toBeNull();
    const got = (ids ?? []).map((x) => x.id);
    expect(got).toContain('1002');
    expect(got).not.toContain('1001');
    expect(lines.some((l) => l.includes('ABANDONED') && l.includes(route.label))).toBe(true);
    // BIN-1423: the call site files the abandoned page under its own type.
    expect(buildCallStats(route.type).abandonedLabels).toEqual([route.label]);
  });

  it('rapporterar de äldsta och räknar resten — inte en rad per sida och puls', async () => {
    route.discover.mockImplementation(() => new Promise(() => {}));
    void route.run().catch(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    const perTick = lines.filter((l) => l.includes('STUCK')).length;
    expect(perTick).toBeLessThanOrEqual(10);
    expect(lines.some((l) => /och \d+ till$/.test(l))).toBe(true);
  });
});
