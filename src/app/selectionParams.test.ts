// BIN-823 — kopplingen mellan de tre routerna och urvalet.
//
// `selectionManifest`s egna tester pinnar spärrhaken, golvet och regimen. Det
// här filen pinnar det INGEN av dem kan se: att varje route faktiskt använder
// dem, och rätt.
//
// Skälet den finns: raden `if (err instanceof SelectionFloorError) throw err;`
// gick att radera ur alla tre routerna med hela sviten (2 747 tester) grön.
// Utan den sväljer routens befintliga catch golvet och returnerar
// `SEO_FALLBACK_*` — tio id:n, GRÖNT bygge, och `firebase deploy` ersätter
// ~31 000 sidor med ~150. Det är exakt den tysta katastrof golvet infördes för.
//
// Sitemapens kast räddar inte den vägen: `mergeManifest(null, type, [], now)`
// skriver ett giltigt men tomt manifest INNAN golvet kastar, så sitemapen
// hittar en läsbar fil, kastar inte, och publicerar frö-URL:erna som sajtens
// kanoniska lista.
//
// Samma fil pinnar också per-route-literalerna `type` och `seedIds` — byt
// `'person'` mot `'movie'` i person-routen och hela trädet förblev grönt.
//
// `fallbackIds` pinnas däremot INTE, och kan inte pinnas här: sedan
// `resolveSelection` sväljer alla icke-golv-fel internt är routens `catch` död
// kod och fallbacken oåtkomlig så länge frölistorna är icketomma (det är de i
// produktion). Mutationstestet 2026-08-08 bekräftade båda: en ändrad
// `fallbackIds` överlevde 9/9, och att radera hela `try/catch` likaså.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const getPopularMovies = vi.fn();
const getTopRatedMovies = vi.fn();
const getPopularTV = vi.fn();
const getTopRatedTV = vi.fn();
const getMovie = vi.fn();

// Sidkomponenterna drar in Firebase; bara generateStaticParams testas här.
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
    getMovie: (...a: unknown[]) => getMovie(...a),
  };
});

import { SelectionFloorError, readSelectionManifest } from '@/lib/tmdb/selectionManifest';
import {
  SEO_FALLBACK_MOVIE_IDS,
  SEO_FALLBACK_TV_IDS,
  SEO_FALLBACK_PERSON_IDS,
} from '@/lib/tmdb/seoCoverage';
import { SEED_MOVIE_IDS, SEED_TV_IDS, SEED_PERSON_IDS } from '@/lib/seo/selectionSeed';
import { generateStaticParams as movieParams } from './movie/[id]/page';
import { generateStaticParams as tvParams } from './tv/[id]/page';
import { generateStaticParams as personParams } from './person/[id]/page';

const ROUTES = [
  {
    name: 'movie/[id]',
    run: movieParams,
    type: 'movie' as const,
    others: ['tv', 'person'] as const,
    fallback: SEO_FALLBACK_MOVIE_IDS,
    seeds: SEED_MOVIE_IDS,
    mocks: [getPopularMovies, getTopRatedMovies],
  },
  {
    name: 'tv/[id]',
    run: tvParams,
    type: 'tv' as const,
    others: ['movie', 'person'] as const,
    fallback: SEO_FALLBACK_TV_IDS,
    seeds: SEED_TV_IDS,
    mocks: [getPopularTV, getTopRatedTV],
  },
  {
    name: 'person/[id]',
    run: personParams,
    type: 'person' as const,
    others: ['movie', 'tv'] as const,
    fallback: SEO_FALLBACK_PERSON_IDS,
    seeds: SEED_PERSON_IDS,
    mocks: [getPopularMovies, getMovie],
  },
];

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
  for (const m of [getPopularMovies, getTopRatedMovies, getPopularTV, getTopRatedTV, getMovie]) {
    m.mockReset();
  }
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
    for (const m of route.mocks) m.mockRejectedValue(new Error('TMDB nere'));

    await expect(route.run()).rejects.toThrow(SelectionFloorError);
  });

  // Den positiva tvillingen: när bygget medvetet får ha ett tunt urval (CI:s
  // dummynyckel) ska en kraschad hämtning INTE fälla något.
  //
  // Den ger ett svar värt mer än fallbacken: det som byggs är FRÖNA — de
  // sidor Google faktiskt har indexerat. Även ett bygge där varenda TMDB-anrop
  // failar producerar alltså dem. `fallbackIds` nås bara om frölistan också
  // vore tom, vilket den aldrig är i produktion.
  it('bygger frö-sidorna även när varje TMDB-anrop failar', async () => {
    process.env.SELECTION_ALLOW_THIN = '1';
    for (const m of route.mocks) m.mockRejectedValue(new Error('TMDB nere'));

    const params = await route.run();
    const ids = params.map(p => Number(p.id));

    expect(ids).toEqual([...route.seeds]);
    expect(ids).not.toEqual([...route.fallback]);
  });

  // Per-route-literalerna. `type` avgör VILKEN fil som läses och skrivs; en
  // förväxling gav grönt träd men fel manifest.
  it('skriver sitt eget manifest och rör inte de andra typernas', async () => {
    process.env.SELECTION_ALLOW_THIN = '1';
    for (const m of route.mocks) m.mockRejectedValue(new Error('TMDB nere'));

    await route.run();

    expect(readSelectionManifest(route.type)).not.toBeNull();
    for (const other of route.others) {
      expect(readSelectionManifest(other)).toBeNull();
    }
  });
});
