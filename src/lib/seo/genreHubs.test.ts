import { describe, it, expect } from 'vitest';
import { GENRE_HUBS, SEO_GENRE_SLUGS, genreHubBySlug } from './genreHubs';
import { GENRE_LABELS } from '@/lib/tmdb/genreLabels';

// BIN-461 — the curated genre-hub list is the single source for the page's
// generateStaticParams, sitemap.ts and hubLinks.ts. These guards keep the list
// shippable: a bad slug 404s a sitemap-committed URL, an unknown TMDB id ships
// an empty page, a >160-char description gets truncated in the SERP.

describe('GENRE_HUBS — slug integrity', () => {
  it('slugs are ASCII url-safe, unique, and mirrored in SEO_GENRE_SLUGS', () => {
    const seen = new Set<string>();
    for (const g of GENRE_HUBS) {
      expect(g.slug).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(g.slug)).toBe(false);
      seen.add(g.slug);
    }
    expect(SEO_GENRE_SLUGS).toEqual(GENRE_HUBS.map((g) => g.slug));
  });

  it('genreHubBySlug resolves every curated slug and rejects unknowns', () => {
    for (const g of GENRE_HUBS) {
      expect(genreHubBySlug(g.slug)?.slug).toBe(g.slug);
    }
    expect(genreHubBySlug('finns-inte')).toBeUndefined();
  });
});

describe('GENRE_HUBS — TMDB id integrity', () => {
  it('every hub has at least one media id, and all ids exist in GENRE_LABELS', () => {
    for (const g of GENRE_HUBS) {
      expect(g.movieGenreId != null || g.tvGenreId != null).toBe(true);
      if (g.movieGenreId != null) {
        expect(GENRE_LABELS[g.movieGenreId], `${g.slug} movieGenreId`).toBeTruthy();
      }
      if (g.tvGenreId != null) {
        expect(GENRE_LABELS[g.tvGenreId], `${g.slug} tvGenreId`).toBeTruthy();
      }
    }
  });

  it('TV-only id space is never used as a movie id and vice versa', () => {
    // Movie discover only understands movie-space ids; TV likewise. The
    // TV-only ids (10759+) on movieGenreId — or movie-only ids on tvGenreId —
    // would silently return zero results at build time.
    const TV_ONLY = new Set([10759, 10762, 10763, 10764, 10765, 10766, 10767, 10768]);
    // TMDB /genre/tv/list lacks these movie-space ids (TV Western=37 exists; Sci-Fi is 10765).
    const MOVIE_ONLY = new Set([36, 27, 10402, 10749, 10770, 53, 10752, 12, 14, 28, 878]);
    for (const g of GENRE_HUBS) {
      if (g.movieGenreId != null) expect(TV_ONLY.has(g.movieGenreId), `${g.slug} movieGenreId is TV-only`).toBe(false);
      if (g.tvGenreId != null) expect(MOVIE_ONLY.has(g.tvGenreId), `${g.slug} tvGenreId is movie-only`).toBe(false);
    }
  });
});

describe('GENRE_HUBS — copy quality gates', () => {
  it('metaDescription fits a SERP snippet and copy fields are non-empty', () => {
    for (const g of GENRE_HUBS) {
      expect(g.label.trim()).toBeTruthy();
      expect(g.h1.trim()).toBeTruthy();
      expect(g.metaTitle.trim()).toBeTruthy();
      expect(g.blurb.trim()).toBeTruthy();
      expect(g.metaDescription.length).toBeLessThanOrEqual(160);
      expect(g.metaDescription.length).toBeGreaterThanOrEqual(50);
    }
  });
});
