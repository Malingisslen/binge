// SEO-13 — a pre-rendered title whose build fetch failed ships `noindex`, and the
// sitemap must leave exactly that URL out. Drives the real generateMetadata of the
// movie route against a failing TMDB fetch, then reads the sitemap from the same
// cache directory, so the two halves cannot drift apart.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const getMovie = vi.fn();
const getTVShow = vi.fn();

vi.mock('@/components/pages/MoviePageClient', () => ({ default: () => null }));
vi.mock('@/components/pages/TVShowPageClient', () => ({ default: () => null }));
vi.mock('@/lib/tmdb/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tmdb/client')>();
  return {
    ...actual,
    getMovie: (...a: unknown[]) => getMovie(...a),
    getTVShow: (...a: unknown[]) => getTVShow(...a),
  };
});

import { __resetBuildFetchState } from '@/lib/tmdb/buildFetch';
import { generateMetadata } from './movie/[id]/page';
import { generateMetadata as tvMetadata } from './tv/[id]/page';
import { movieSitemapEntries, tvSitemapEntries } from '@/lib/seo/sitemap';
import { MANIFEST_VERSION, writeSelectionManifest } from '@/lib/tmdb/selectionManifest';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sitemap-failed-fetch-'));
  process.env.TMDB_CACHE_DIR = dir;
  delete process.env.SELECTION_ALLOW_THIN;
  __resetBuildFetchState();
  getMovie.mockReset();
  writeSelectionManifest({
    version: MANIFEST_VERSION,
    type: 'movie',
    derivedAt: 1_000_000,
    ids: [{ id: 501, lastDerived: 1_000_000 }],
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TMDB_CACHE_DIR;
});

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const movieUrls = () => movieSitemapEntries().map(e => e.url);

describe('sitemap ↔ noindex for a failed build fetch (SEO-13)', () => {
  it('the URL rendered noindex is the URL the sitemap leaves out', async () => {
    getMovie.mockRejectedValue(new Error('TMDB down'));

    const meta = await generateMetadata(params(501));

    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(movieUrls()).not.toContain('https://binge.nu/movie/501/');
  });

  it('a later successful build puts the URL back', async () => {
    getMovie.mockRejectedValueOnce(new Error('TMDB down'));
    await generateMetadata(params(501));
    expect(movieUrls()).not.toContain('https://binge.nu/movie/501/');

    __resetBuildFetchState();
    getMovie.mockResolvedValue({
      id: 501, title: 'Testfilm', original_title: 'Testfilm', overview: '', genres: [], credits: { cast: [], crew: [] },
    });
    const meta = await generateMetadata(params(501));

    expect(meta.robots).toBeUndefined();
    expect(movieUrls()).toContain('https://binge.nu/movie/501/');
    // #26:s villkor 3 (ADR 0024): en kärnsidas canonical i den statiska HTML:en
    // är exakt den URL sitemapen listar, med avslutande snedstreck.
    expect(meta.alternates?.canonical).toBe(movieUrls()[0]);
  });
});

// #26:s villkor 3 (ADR 0024), serie-routens halva.
describe('core tv page canonical', () => {
  it('equals the URL the sitemap lists', async () => {
    writeSelectionManifest({
      version: MANIFEST_VERSION,
      type: 'tv',
      derivedAt: 1_000_000,
      ids: [{ id: 601, lastDerived: 1_000_000 }],
    });
    getTVShow.mockResolvedValue({
      id: 601, name: 'Testserie', original_name: 'Testserie', overview: '', genres: [],
      first_air_date: '2020-01-01', credits: { cast: [], crew: [] },
    });

    const meta = await tvMetadata(params(601));

    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe(tvSitemapEntries().map(e => e.url)[0]);
  });
});
