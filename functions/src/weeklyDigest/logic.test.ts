import { describe, it, expect } from 'vitest';
import {
  daysUntilLeaving,
  buildLeavingDigest,
  digestOfferKey,
  digestPushBody,
  hasDigestContent,
  type DigestOffer,
  type DigestTitle,
} from './logic';

/**
 * Offers map keyed the way production keys it — `${mediaType}_${tmdbId}`
 * (BIN-523). mediaType defaults to 'movie' to match the `title` helper below.
 */
const omap = (
  rows: Array<[number, DigestOffer[], ('movie' | 'tv')?]>,
): Map<string, DigestOffer[]> =>
  new Map(rows.map(([tmdbId, os, mediaType]) => [digestOfferKey({ tmdbId, mediaType: mediaType ?? 'movie' }), os]));

const NOW = Date.parse('2026-07-01T12:00:00Z');

function offers(...os: Array<Partial<DigestOffer>>): DigestOffer[] {
  return os.map((o) => ({ providerId: 8, type: 'subscription', leaving: null, ...o }));
}

const title = (tmdbId: number, name: string, mediaType: 'movie' | 'tv' = 'movie'): DigestTitle => ({
  tmdbId,
  title: name,
  mediaType,
});

describe('daysUntilLeaving', () => {
  it('reads a bare date as a whole-day countdown (leaving today = 0)', () => {
    expect(daysUntilLeaving('2026-07-01', NOW)).toBe(0);
    expect(daysUntilLeaving('2026-07-06', NOW)).toBe(5);
  });

  it('is negative for a past date, the full day it leaves stays 0', () => {
    expect(daysUntilLeaving('2026-06-30', NOW)).toBe(-1);
  });

  it('returns null for missing or malformed dates', () => {
    expect(daysUntilLeaving(null, NOW)).toBeNull();
    expect(daysUntilLeaving('', NOW)).toBeNull();
    expect(daysUntilLeaving('soon', NOW)).toBeNull();
    expect(daysUntilLeaving('2026-13-99', NOW)).toBeNull();
  });
});

describe('buildLeavingDigest', () => {
  const myProviders = [8, 384]; // Netflix + Max (canonical)

  it('includes a subscription title leaving soon on a provider the user has', () => {
    const map = omap([[1, offers({ providerId: 8, leaving: '2026-07-06' })]]);
    const out = buildLeavingDigest([title(1, 'Dune')], map, myProviders, NOW);
    expect(out).toEqual([{ tmdbId: 1, title: 'Dune', mediaType: 'movie', leaving: '2026-07-06', daysLeft: 5 }]);
  });

  it('excludes a title leaving on a provider the user does NOT subscribe to', () => {
    const map = omap([[1, offers({ providerId: 119, leaving: '2026-07-06' })]]); // Prime, not owned
    expect(buildLeavingDigest([title(1, 'Dune')], map, myProviders, NOW)).toEqual([]);
  });

  it('excludes rent/buy offers — only a SUBSCRIPTION leaving counts', () => {
    const map = omap([[1, offers({ providerId: 8, type: 'rent', leaving: '2026-07-06' })]]);
    expect(buildLeavingDigest([title(1, 'Dune')], map, myProviders, NOW)).toEqual([]);
  });

  it('excludes titles leaving outside the window or already past', () => {
    const map = omap([
      [1, offers({ providerId: 8, leaving: '2026-07-21' })], // 20d out, > 14
      [2, offers({ providerId: 8, leaving: '2026-06-30' })], // already past
    ]);
    expect(buildLeavingDigest([title(1, 'A'), title(2, 'B')], map, myProviders, NOW)).toEqual([]);
  });

  it('is inclusive at the window edge (14d in, 15d out)', () => {
    const at = omap([[10, offers({ providerId: 8, leaving: '2026-07-15' })]]); // exactly 14d
    expect(buildLeavingDigest([title(10, 'Edge')], at, myProviders, NOW)).toHaveLength(1);
    const over = omap([[11, offers({ providerId: 8, leaving: '2026-07-16' })]]); // 15d
    expect(buildLeavingDigest([title(11, 'Over')], over, myProviders, NOW)).toHaveLength(0);
  });

  it('includes a title leaving today (0d) and sorts it first', () => {
    const map = omap([
      [1, offers({ providerId: 8, leaving: '2026-07-03' })], // 2d
      [2, offers({ providerId: 8, leaving: '2026-07-01' })], // today, 0d
    ]);
    const out = buildLeavingDigest([title(1, 'Later'), title(2, 'Today')], map, myProviders, NOW);
    expect(out.map((i) => i.title)).toEqual(['Today', 'Later']);
    expect(out[0].daysLeft).toBe(0);
  });

  it('picks the soonest-leaving owned provider when a title has several', () => {
    const map = omap([[1, offers(
      { providerId: 8, leaving: '2026-07-10' },   // 9d
      { providerId: 384, leaving: '2026-07-04' }, // 3d — sooner
    )]]);
    const out = buildLeavingDigest([title(1, 'Dune')], map, myProviders, NOW);
    expect(out[0].daysLeft).toBe(3);
    expect(out[0].leaving).toBe('2026-07-04');
  });

  it('matches an aliased provider id against the canonical the user stored', () => {
    // User has canonical Max (384); the offer is under alias 1899.
    const map = omap([[1, offers({ providerId: 1899, leaving: '2026-07-05' }), 'tv']]);
    const out = buildLeavingDigest([title(1, 'Max show', 'tv')], map, [384], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].daysLeft).toBe(4);
  });

  it('sorts nearest-deadline-first across titles', () => {
    const map = omap([
      [1, offers({ providerId: 8, leaving: '2026-07-12' })], // 11d
      [2, offers({ providerId: 8, leaving: '2026-07-03' })], // 2d
      [3, offers({ providerId: 8, leaving: '2026-07-08' })], // 7d
    ]);
    const out = buildLeavingDigest([title(1, 'A'), title(2, 'B'), title(3, 'C')], map, myProviders, NOW);
    expect(out.map((i) => i.title)).toEqual(['B', 'C', 'A']);
  });

  // BIN-523 discriminating oracle: keyed on bare tmdbId, the TV show's offers
  // were handed to the movie too, inventing a "leaving soon" warning for a title
  // that isn't leaving anything.
  it('does not give movie N the offers belonging to TV N', () => {
    const map = omap([[1, offers({ providerId: 8, leaving: '2026-07-06' }), 'tv']]);
    const out = buildLeavingDigest([title(1, 'Serien', 'tv'), title(1, 'Filmen', 'movie')], map, myProviders, NOW);
    expect(out.map((i) => i.title)).toEqual(['Serien']);
  });

  it('returns empty when a title has no offers doc', () => {
    expect(buildLeavingDigest([title(99, 'Unknown')], omap([]), myProviders, NOW)).toEqual([]);
  });
});

describe('digestPushBody + hasDigestContent', () => {
  it('combines both halves', () => {
    expect(digestPushBody(3, 2)).toBe('3 titlar lämnar dina tjänster snart · 2 nya den här veckan');
  });

  it('uses singular forms for a count of one', () => {
    expect(digestPushBody(1, 1)).toBe('1 titel lämnar dina tjänster snart · 1 ny den här veckan');
  });

  it('omits an empty half rather than writing "0 ..."', () => {
    expect(digestPushBody(2, 0)).toBe('2 titlar lämnar dina tjänster snart');
    expect(digestPushBody(0, 4)).toBe('4 nya den här veckan');
  });

  it('hasDigestContent is true if either half is non-empty', () => {
    expect(hasDigestContent(0, 0)).toBe(false);
    expect(hasDigestContent(1, 0)).toBe(true);
    expect(hasDigestContent(0, 1)).toBe(true);
  });
});
