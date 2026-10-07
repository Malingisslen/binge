import { describe, it, expect } from 'vitest';
import {
  providerLinks,
  franchiseLinks,
  leavingLinks,
  genreLinks,
  costLinks,
  hubSections,
  providerHubHref,
  leavingHubHref,
  genreHubHref,
} from './hubLinks';
import { FRANCHISES } from './franchises';
import { GENRE_HUBS } from './genreHubs';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';

// The whole point of the hub is FULL coverage — every curated SEO landing page
// must be linked, or the page silently orphans the ones it drops (the exact bug
// BIN-424 exists to fix). These guards fail if a franchise/provider is added to
// the constants but doesn't reach the hub, or if a curated provider id stops
// resolving to a real provider (a broken /provider + /forsvinner link).

describe('hubLinks — franchise coverage', () => {
  it('links every franchise page, none dropped', () => {
    const links = franchiseLinks();
    expect(links).toHaveLength(FRANCHISES.length);
    for (const f of FRANCHISES) {
      expect(links).toContainEqual({ href: `/billigaste/${f.slug}/`, label: f.name });
    }
  });
});

describe('hubLinks — provider coverage', () => {
  it('links every curated provider landing page (all ids resolve)', () => {
    const links = providerLinks();
    // Every SEO provider id must resolve to a real provider — else the curated
    // list references a service Binge can't name.
    expect(links).toHaveLength(SEO_PROVIDER_IDS.length);
    for (const pid of SEO_PROVIDER_IDS) {
      expect(links.some((l) => l.href === `/provider/${pid}/`)).toBe(true);
    }
  });

  it('links every provider "försvinner" page, one per provider', () => {
    const links = leavingLinks();
    expect(links).toHaveLength(SEO_PROVIDER_IDS.length);
    for (const pid of SEO_PROVIDER_IDS) {
      expect(links.some((l) => l.href === `/forsvinner/${pid}/`)).toBe(true);
    }
  });
});

describe('hubLinks — genre coverage (BIN-461)', () => {
  it('links every curated genre hub page, none dropped', () => {
    const links = genreLinks();
    expect(links).toHaveLength(GENRE_HUBS.length);
    for (const g of GENRE_HUBS) {
      expect(links).toContainEqual({ href: `/genre/${g.slug}/`, label: g.label });
    }
  });
});

describe('hubLinks — sections', () => {
  it('exposes exactly the five hub groups with links', () => {
    const sections = hubSections();
    expect(sections.map((s) => s.id)).toEqual([
      'streamingtjanster',
      'billigaste',
      'forsvinner',
      'genre',
      'kostnad',
    ]);
    for (const s of sections) {
      expect(s.links.length).toBeGreaterThan(0);
      expect(s.heading).toBeTruthy();
    }
  });

  it('produces only root-relative, trailing-slash hrefs (static-export safe)', () => {
    const all = hubSections().flatMap((s) => s.links);
    for (const l of all) {
      expect(l.href.startsWith('/')).toBe(true);
      expect(l.href.endsWith('/')).toBe(true);
    }
  });
});

describe('hubLinks — links from title pages into hubs (SEO-4)', () => {
  it('links a curated provider, resolving an alias id to the canonical hub', () => {
    expect(providerHubHref(8)).toBe('/provider/8/');
    // 175 = Netflix Kids, an alias of 8 in SWEDISH_PROVIDERS.
    expect(providerHubHref(175)).toBe('/provider/8/');
    expect(leavingHubHref(175)).toBe('/forsvinner/8/');
  });

  it('returns null for a provider outside the pre-rendered set', () => {
    // 11 = MUBI: a known provider, but not in SEO_PROVIDER_IDS.
    expect(SEO_PROVIDER_IDS).not.toContain(11);
    expect(providerHubHref(11)).toBeNull();
    expect(leavingHubHref(11)).toBeNull();
  });

  it('every href it can return is one the hub pages pre-render', () => {
    const provider = new Set(providerLinks().map((l) => l.href));
    const leaving = new Set(leavingLinks().map((l) => l.href));
    const genre = new Set(genreLinks().map((l) => l.href));
    for (const pid of SEO_PROVIDER_IDS) {
      expect(provider.has(providerHubHref(pid)!)).toBe(true);
      expect(leaving.has(leavingHubHref(pid)!)).toBe(true);
    }
    for (const g of GENRE_HUBS) {
      if (g.movieGenreId !== undefined) expect(genre.has(genreHubHref('movie', g.movieGenreId)!)).toBe(true);
      if (g.tvGenreId !== undefined) expect(genre.has(genreHubHref('tv', g.tvGenreId)!)).toBe(true);
    }
  });

  it('keeps the movie and TV genre id spaces apart', () => {
    // 10759 is TV "Action & Äventyr"; as a movie id it means nothing.
    expect(genreHubHref('tv', 10759)).toBe('/genre/action/');
    expect(genreHubHref('movie', 10759)).toBeNull();
    // 53 Thriller has a movie hub only (TV has no Thriller genre).
    expect(genreHubHref('movie', 53)).toBe('/genre/thriller/');
    expect(genreHubHref('tv', 53)).toBeNull();
  });
});

// #26:s villkor 1 och 4 (pengakollen publikt, 2026-10-05): kalkylatorn länkas från
// hubben, prissidan gör det inte så länge den är noindex.
describe('hubLinks — kostnadslänkar', () => {
  it('links the calculator /streamingkostnad/ from the hub', () => {
    expect(costLinks()).toContainEqual({ href: '/streamingkostnad/', label: 'Räkna ut din streamingkostnad' });
    const all = hubSections().flatMap((s) => s.links.map((l) => l.href));
    expect(all).toContain('/streamingkostnad/');
  });

  it('does NOT link the noindex price page /streamingpriser/', () => {
    const all = hubSections().flatMap((s) => s.links.map((l) => l.href));
    expect(all.some((h) => h.startsWith('/streamingpriser'))).toBe(false);
  });

  it('does NOT link the hidden month page /vart-det/ before Malin publishes it', () => {
    const all = hubSections().flatMap((s) => s.links.map((l) => l.href));
    expect(all.some((h) => h.startsWith('/vart-det'))).toBe(false);
  });
});
