import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sitemap from './sitemap';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';
import { SEO_GENRE_SLUGS } from '@/lib/seo/genreHubs';
import {
  MANIFEST_VERSION,
  type SelectionManifest,
  type SelectionType,
  writeSelectionManifest,
} from '@/lib/tmdb/selectionManifest';
import { SEED_MOVIE_IDS, SEED_TV_IDS, SEED_PERSON_IDS } from '@/lib/seo/selectionSeed';

// BIN-823: sitemapen gör inga TMDB-anrop längre — den LÄSER urvalsmanifesten
// som pre-rendren skrev i en tidigare byggfas. Därför mockas inte klienten här;
// testet skriver riktiga manifest till en temporär cache-katalog i stället.
// Paritet mellan sitemap och pre-render är nu strukturell (en artefakt, två
// läsare) snarare än ett löfte om att två kodvägar beter sig lika.

let dir: string;

function writeManifest(type: SelectionType, ids: number[]): void {
  const manifest: SelectionManifest = {
    version: MANIFEST_VERSION,
    type,
    derivedAt: 1_000_000,
    ids: ids.map(id => ({ id, lastDerived: 1_000_000 })),
  };
  writeSelectionManifest(manifest);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sitemap-selection-test-'));
  process.env.TMDB_CACHE_DIR = dir;
  writeManifest('movie', [1, 2]);
  writeManifest('tv', [3, 4]);
  writeManifest('person', [100]);
  // I BÅDA krokarna, med flit. Den verkliga risken är inte att den här filens
  // egna kast-tester no-oppar varandra — de ligger före settern i filordning och
  // kan inte det — utan att en ANNAN fil i samma worker lämnat flaggan satt.
  // Det kan bara en beforeEach stoppa. (Testgranskningen 2026-08-08: enbart
  // afterEach gick att radera med 74/74 grönt.)
  delete process.env.SELECTION_ALLOW_THIN;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TMDB_CACHE_DIR;
  delete process.env.SELECTION_ALLOW_THIN;
});

const EXPECTED_STATIC = [
  'https://binge.nu/',
  'https://binge.nu/discover/',
  'https://binge.nu/guider/', // BIN-424 hub-of-hubs index
  'https://binge.nu/films/',
  'https://binge.nu/series/',
  'https://binge.nu/integritet/',
  'https://binge.nu/villkor/',
  'https://binge.nu/community-guidelines/',
];

describe('sitemap — BIN-337 URL shape + family coverage', () => {
  it('every entry is an absolute binge.nu URL ending in a trailing slash', () => {
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.url.startsWith('https://binge.nu/'), `bad origin: ${e.url}`).toBe(true);
      expect(e.url.endsWith('/'), `missing trailing slash: ${e.url}`).toBe(true);
    }
  });

  it('includes a representative URL from every parity-critical family', () => {
    const urls = new Set(sitemap().map(e => e.url));
    expect(urls.has('https://binge.nu/movie/1/')).toBe(true);
    expect(urls.has('https://binge.nu/tv/3/')).toBe(true);
    expect(urls.has('https://binge.nu/person/100/')).toBe(true);
    expect(urls.has(`https://binge.nu/provider/${SEO_PROVIDER_IDS[0]}/`)).toBe(true);
    expect(urls.has(`https://binge.nu/forsvinner/${SEO_PROVIDER_IDS[0]}/`)).toBe(true);
    expect([...urls].some(u => /^https:\/\/binge\.nu\/billigaste\/[^/]+\/$/.test(u))).toBe(true);
    // BIN-461 — genre hubs must match the page's generateStaticParams set.
    expect(urls.has(`https://binge.nu/genre/${SEO_GENRE_SLUGS[0]}/`)).toBe(true);
  });

  it('genre family is EXACTLY the curated slug set — none dropped, none extra (BIN-461)', () => {
    const genreUrls = sitemap().map(e => e.url).filter(u => u.includes('/genre/'));
    // Two-sided, like the static-route guard: a sitemap /genre/ URL outside
    // generateStaticParams' set would build to nothing (dynamicParams=false)
    // and serve the noindex catch-all shell — a sitemap-committed soft-404.
    expect(genreUrls.sort()).toEqual(
      SEO_GENRE_SLUGS.map(slug => `https://binge.nu/genre/${slug}/`).sort(),
    );
  });

  it('lists exactly the 8 public static routes — no auth-walled/noindex pages leak in', () => {
    const all = sitemap().map(e => e.url);
    const urls = new Set(all);
    for (const u of EXPECTED_STATIC) expect(urls.has(u), `missing static: ${u}`).toBe(true);
    // Two-sided: the static (non-dynamic) route set must be EXACTLY these 8, so a
    // newly-added top-level page (esp. an auth-walled one) can't silently leak in.
    const DYNAMIC_PREFIXES = ['/movie/', '/tv/', '/person/', '/provider/', '/billigaste/', '/forsvinner/', '/genre/'];
    const staticUrls = all.filter(u => !DYNAMIC_PREFIXES.some(p => u.includes(p)));
    expect(staticUrls.sort()).toEqual([...EXPECTED_STATIC].sort());
    // Auth-walled / noindex routes must never appear (GSC "submitted URL marked noindex").
    // BIN-305: /savings/ is now auth-walled + robots:noindex, so it must NOT leak in.
    for (const leak of ['/my', '/login', '/settings', '/feed', '/kalibrera', '/stats', '/savings']) {
      expect([...urls].some(u => u.includes(`binge.nu${leak}`)), `leaked: ${leak}`).toBe(false);
    }
  });

  it('emits no duplicate URLs (crawl-budget hygiene)', () => {
    const all = sitemap().map(e => e.url);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('sitemap — urvalsmanifestet (BIN-823)', () => {
  // MEDVETEN OMVÄNDNING. Den här testfilen pinnade tidigare motsatsen: "faller
  // tillbaka på icke-titel-poster om TMDB-hämtningen failar (bygget förblir
  // grönt)". Det var rätt när sitemapen SJÄLV hämtade från TMDB — en nätverkshick
  // skulle inte fälla ett bygge. Nu läser den en lokal fil som pre-rendren
  // precis skrivit; saknas den har urvalet aldrig producerats, och en sitemap
  // med bara de statiska familjerna vore ett aktivt felaktigt påstående till
  // Google om att sajten har ~60 sidor.
  it('kastar hellre än att publicera en sitemap utan titlar när manifestet saknas', () => {
    rmSync(join(dir, 'selection-movie.json'));

    expect(() => sitemap()).toThrow(/urvalsmanifestet för movie saknas/);
  });

  it('kastar även när bara person-manifestet saknas', () => {
    rmSync(join(dir, 'selection-person.json'));

    expect(() => sitemap()).toThrow(/urvalsmanifestet för person saknas/);
  });

  // Undantaget för preview/CI. Utan det är preview-lättnaden bara halv: en
  // strypt personhärledning som slår i räddningstaket skriver aldrig något
  // manifest, så previewen hade gått röd HÄR i stället för på golvet, trots
  // SELECTION_ALLOW_THIN. Integrationsgranskningen 2026-08-08 spårade den
  // grenen till den mätta persontiden 2 672 s mot ett tak på 900 s.
  it('faller tillbaka på frö-id:n i stället för att kasta när tunt urval är tillåtet', () => {
    process.env.SELECTION_ALLOW_THIN = '1';
    rmSync(join(dir, 'selection-person.json'));
    rmSync(join(dir, 'selection-movie.json'));

    const urls = new Set(sitemap().map(e => e.url));

    expect(urls.has(`https://binge.nu/person/${SEED_PERSON_IDS[0]}/`)).toBe(true);
    expect(urls.has(`https://binge.nu/movie/${SEED_MOVIE_IDS[0]}/`)).toBe(true);
    // Manifestet finns kvar för tv — den typen ska inte tappa sina id:n.
    expect(urls.has('https://binge.nu/tv/3/')).toBe(true);
    // …men de raderade manifestens egna id:n är borta, alltså är det verkligen
    // frö-fallbacken som svarar och inte en läsning av en kvarglömd fil.
    expect(urls.has('https://binge.nu/movie/1/')).toBe(false);
  });

  // Frö-id:na unioneras in vid läsning i BÅDE sitemap och pre-render, så de kan
  // inte hamna i den ena men inte den andra.
  it('tar med frö-id:n som inte finns i manifestet', () => {
    const urls = new Set(sitemap().map(e => e.url));

    expect(urls.has(`https://binge.nu/movie/${SEED_MOVIE_IDS[0]}/`)).toBe(true);
    expect(urls.has(`https://binge.nu/tv/${SEED_TV_IDS[0]}/`)).toBe(true);
    expect(urls.has(`https://binge.nu/person/${SEED_PERSON_IDS[0]}/`)).toBe(true);
  });

  it('adresserar exakt manifestets id-mängd ∪ fröna, inget mer', () => {
    const movieUrls = sitemap()
      .map(e => e.url)
      .filter(u => u.startsWith('https://binge.nu/movie/'));
    const expected = new Set([1, 2, ...SEED_MOVIE_IDS].map(id => `https://binge.nu/movie/${id}/`));

    expect(new Set(movieUrls)).toEqual(expected);
  });
});
