import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the TMDB client so the build-time fetches return small deterministic
// fixtures — both sitemap.ts (titles) and collectPersonIds (persons) read this.
vi.mock('@/lib/tmdb/client', () => ({
  getPopularMovies: vi.fn(),
  getTopRatedMovies: vi.fn(),
  getPopularTV: vi.fn(),
  getTopRatedTV: vi.fn(),
  getMovie: vi.fn(),
}));

import {
  getPopularMovies,
  getTopRatedMovies,
  getPopularTV,
  getTopRatedTV,
  getMovie,
} from '@/lib/tmdb/client';
import sitemap from './sitemap';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';
import { SEO_GENRE_SLUGS } from '@/lib/seo/genreHubs';

const list = (ids: number[]) => ({ results: ids.map(id => ({ id })) } as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPopularMovies).mockResolvedValue(list([1]));
  vi.mocked(getTopRatedMovies).mockResolvedValue(list([2]));
  vi.mocked(getPopularTV).mockResolvedValue(list([3]));
  vi.mocked(getTopRatedTV).mockResolvedValue(list([4]));
  vi.mocked(getMovie).mockResolvedValue({ credits: { cast: [{ id: 100 }] } } as never);
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
  it('every entry is an absolute binge.nu URL ending in a trailing slash', async () => {
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.url.startsWith('https://binge.nu/'), `bad origin: ${e.url}`).toBe(true);
      expect(e.url.endsWith('/'), `missing trailing slash: ${e.url}`).toBe(true);
    }
  });

  it('includes a representative URL from every parity-critical family', async () => {
    const urls = new Set((await sitemap()).map(e => e.url));
    expect(urls.has('https://binge.nu/movie/1/')).toBe(true);
    expect(urls.has('https://binge.nu/tv/3/')).toBe(true);
    expect(urls.has('https://binge.nu/person/100/')).toBe(true);
    expect(urls.has(`https://binge.nu/provider/${SEO_PROVIDER_IDS[0]}/`)).toBe(true);
    expect(urls.has(`https://binge.nu/forsvinner/${SEO_PROVIDER_IDS[0]}/`)).toBe(true);
    expect([...urls].some(u => /^https:\/\/binge\.nu\/billigaste\/[^/]+\/$/.test(u))).toBe(true);
    // BIN-461 — genre hubs must match the page's generateStaticParams set.
    expect(urls.has(`https://binge.nu/genre/${SEO_GENRE_SLUGS[0]}/`)).toBe(true);
  });

  it('genre family is EXACTLY the curated slug set — none dropped, none extra (BIN-461)', async () => {
    const genreUrls = (await sitemap()).map(e => e.url).filter(u => u.includes('/genre/'));
    // Two-sided, like the static-route guard: a sitemap /genre/ URL outside
    // generateStaticParams' set would build to nothing (dynamicParams=false)
    // and serve the noindex catch-all shell — a sitemap-committed soft-404.
    expect(genreUrls.sort()).toEqual(
      SEO_GENRE_SLUGS.map(slug => `https://binge.nu/genre/${slug}/`).sort(),
    );
  });

  it('lists exactly the 8 public static routes — no auth-walled/noindex pages leak in', async () => {
    const all = (await sitemap()).map(e => e.url);
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

  it('emits no duplicate URLs (crawl-budget hygiene)', async () => {
    const all = (await sitemap()).map(e => e.url);
    expect(new Set(all).size).toBe(all.length);
  });

  it('falls back to non-title entries if the TMDB title fetch fails (build stays green)', async () => {
    vi.mocked(getPopularMovies).mockRejectedValue(new Error('TMDB down'));
    vi.mocked(getTopRatedMovies).mockRejectedValue(new Error('TMDB down'));
    vi.mocked(getPopularTV).mockRejectedValue(new Error('TMDB down'));
    vi.mocked(getTopRatedTV).mockRejectedValue(new Error('TMDB down'));
    const entries = await sitemap();
    // Static + provider + franchise + forsvinner families still present.
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(e => e.url.startsWith('https://binge.nu/') && e.url.endsWith('/'))).toBe(true);
    expect(entries.some(e => e.url.includes('/provider/'))).toBe(true);
  });
});
