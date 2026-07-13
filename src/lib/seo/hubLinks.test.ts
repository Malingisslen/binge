import { describe, it, expect } from 'vitest';
import {
  providerLinks,
  franchiseLinks,
  leavingLinks,
  genreLinks,
  hubSections,
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
  it('exposes exactly the four hub groups with links', () => {
    const sections = hubSections();
    expect(sections.map((s) => s.id)).toEqual([
      'streamingtjanster',
      'billigaste',
      'forsvinner',
      'genre',
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
