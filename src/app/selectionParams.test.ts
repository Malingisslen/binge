// BIN-823 — kopplingen mellan titelroutrarna och urvalet.
//
// `selectionManifest`s egna tester pinnar spärrhaken, golvet och regimen. Det
// här filen pinnar det INGEN av dem kan se: att varje route faktiskt använder
// dem, och rätt.
//
// Skälet den finns: raden `if (err instanceof SelectionFloorError) throw err;`
// gick att radera ur routerna med hela sviten grön. Utan den sväljer routens
// befintliga catch golvet och returnerar `SEO_FALLBACK_*` — tio id:n, GRÖNT
// bygge, och `firebase deploy` ersätter kärnan med en handfull sidor.
//
// Samma fil pinnar per-route-literalen `type`, att härledningen frågar efter
// titlar med svensk tjänst (ADR 0024), och att personroutens förrendering är
// fallback-listan och ingenting annat.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const discoverMovies = vi.fn();
const discoverTV = vi.fn();
const getPerson = vi.fn();

// Sidkomponenterna drar in Firebase; bara generateStaticParams testas här.
vi.mock('@/components/pages/MoviePageClient', () => ({ default: () => null }));
vi.mock('@/components/pages/TVShowPageClient', () => ({ default: () => null }));
vi.mock('@/components/pages/PersonPageClient', () => ({ default: () => null }));

vi.mock('@/lib/tmdb/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tmdb/client')>();
  return {
    ...actual,
    discoverMovies: (...a: unknown[]) => discoverMovies(...a),
    discoverTV: (...a: unknown[]) => discoverTV(...a),
    getPerson: (...a: unknown[]) => getPerson(...a),
  };
});

import { SelectionFloorError, readSelectionManifest } from '@/lib/tmdb/selectionManifest';
import {
  SEO_FALLBACK_MOVIE_IDS,
  SEO_FALLBACK_TV_IDS,
  SEO_FALLBACK_PERSON_IDS,
  SEO_CORE_DISCOVER_PAGES,
  SEO_TITLE_TARGET_IDS,
} from '@/lib/tmdb/seoCoverage';
import { generateStaticParams as movieParams } from './movie/[id]/page';
import { generateStaticParams as tvParams } from './tv/[id]/page';
import { generateStaticParams as personParams, generateMetadata as personMetadata } from './person/[id]/page';
import { __resetBuildFetchState } from '@/lib/tmdb/buildFetch';

const ROUTES = [
  {
    name: 'movie/[id]',
    run: movieParams,
    type: 'movie' as const,
    other: 'tv' as const,
    fallback: SEO_FALLBACK_MOVIE_IDS,
    discover: discoverMovies,
  },
  {
    name: 'tv/[id]',
    run: tvParams,
    type: 'tv' as const,
    other: 'movie' as const,
    fallback: SEO_FALLBACK_TV_IDS,
    discover: discoverTV,
  },
];

/** En /discover-sida med 20 titlar och latinska titlar, unika per sida. */
function discoverPage(params: Record<string, string>) {
  const page = Number(params.page);
  return Promise.resolve({
    results: Array.from({ length: 20 }, (_, i) => ({ id: page * 100 + i, title: `Titel ${page}-${i}` })),
  });
}

let dir: string;
let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'selection-params-test-'));
  process.env.TMDB_CACHE_DIR = dir;
  process.env.TMDB_SELECTION_REFRESH = '1';
  delete process.env.SELECTION_ALLOW_THIN;
  // resolveSelection skriver ::warning::-rader; utan spy blir de riktiga
  // GitHub Actions-annoteringar på varje grön testkörning.
  stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  for (const m of [discoverMovies, discoverTV, getPerson]) m.mockReset();
  __resetBuildFetchState();
});

afterEach(() => {
  stderr.mockRestore();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TMDB_CACHE_DIR;
  delete process.env.TMDB_SELECTION_REFRESH;
  delete process.env.SELECTION_ALLOW_THIN;
});

describe.each(ROUTES)('$name — urvalskopplingen (BIN-823)', (route) => {
  it('låter täckningsgolvet FÄLLA bygget i stället för att falla tillbaka', async () => {
    // Kall cache + varje list-hämtning failar ⇒ tomt urval ⇒ golvet ska kasta.
    route.discover.mockRejectedValue(new Error('TMDB nere'));

    await expect(route.run()).rejects.toThrow(SelectionFloorError);
  });

  // Den positiva tvillingen: när bygget medvetet får ha ett tunt urval ska en
  // kraschad hämtning INTE fälla något, och då är det fallback-listan som byggs.
  it('bygger fallback-sidorna när varje TMDB-anrop failar under SELECTION_ALLOW_THIN', async () => {
    process.env.SELECTION_ALLOW_THIN = '1';
    route.discover.mockRejectedValue(new Error('TMDB nere'));

    const params = await route.run();

    expect(params.map(p => Number(p.id))).toEqual([...route.fallback]);
  });

  // Per-route-literalerna. `type` avgör VILKEN fil som läses och skrivs; en
  // förväxling gav grönt träd men fel manifest.
  it('skriver sitt eget manifest och rör inte den andra typens', async () => {
    route.discover.mockImplementation(discoverPage);

    await route.run();

    expect(readSelectionManifest(route.type)).not.toBeNull();
    expect(readSelectionManifest(route.other)).toBeNull();
  });

  // ADR 0024: kärnan är titlar som går att se på en svensk tjänst, i
  // popularitetsordning, kapad vid målet.
  it('härleder kärnan ur /discover med krav på svensk tjänst', async () => {
    route.discover.mockImplementation(discoverPage);

    const params = await route.run();

    expect(route.discover).toHaveBeenCalledTimes(SEO_CORE_DISCOVER_PAGES);
    for (const [args] of route.discover.mock.calls) {
      expect(args).toMatchObject({
        sort_by: 'popularity.desc',
        with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
      });
    }
    const ids = params.map(p => Number(p.id));
    expect(ids).toHaveLength(SEO_TITLE_TARGET_IDS);
    // Sida 1 först: popularitetsordningen överlever hela vägen till params.
    expect(ids[0]).toBe(100);
    expect(readSelectionManifest(route.type)?.ids).toHaveLength(SEO_TITLE_TARGET_IDS);
  });
});

describe('person/[id] — ingen förrendering för Google (ADR 0024)', () => {
  it('bygger bara fallback-listan, utan TMDB-anrop och utan manifest', async () => {
    const params = await personParams();

    expect(params.map(p => Number(p.id))).toEqual([...SEO_FALLBACK_PERSON_IDS]);
    expect(discoverMovies).not.toHaveBeenCalled();
    expect(discoverTV).not.toHaveBeenCalled();
  });

  // Den statiska HTML:en är det Google läser först; utan noindex där hade de
  // förrenderade fallback-personerna varit indexerbara tills JavaScript kört.
  const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

  it('säger noindex,follow när hämtningen lyckas', async () => {
    getPerson.mockResolvedValue({
      id: SEO_FALLBACK_PERSON_IDS[0], name: 'Testperson', biography: '', profile_path: null,
      known_for_department: 'Acting', combined_credits: { cast: [], crew: [] },
    });

    const meta = await personMetadata(params(SEO_FALLBACK_PERSON_IDS[0]));

    expect(meta.title).toContain('Testperson');
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('säger noindex,follow när hämtningen misslyckas', async () => {
    getPerson.mockRejectedValue(new Error('TMDB nere'));

    const meta = await personMetadata(params(SEO_FALLBACK_PERSON_IDS[1]));

    expect(meta.robots).toEqual({ index: false, follow: true });
  });
});
