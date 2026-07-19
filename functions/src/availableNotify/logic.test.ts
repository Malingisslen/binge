import { describe, it, expect } from 'vitest';
import { diffNewProviders, qualifyingProviders, canonicalProviderId, normalizeMediaType, availableStateDocId, inboxNotifId } from './logic';

describe('canonicalProviderId (BIN-60)', () => {
  it('maps every known alias to its canonical id (full map pinned vs providers.ts)', () => {
    const expected: Record<number, number> = {
      1899: 384, 1825: 384,   // Max
      493: 520,               // SVT Play
      1944: 489, 1759: 489,   // TV4 Play
      2243: 350,              // Apple TV+
      1968: 323, 283: 323,    // Crunchyroll
      1773: 431,              // SkyShowtime
      188: 335,               // YouTube Premium
      497: 521,               // Tele2 Play
      517: 578,               // TriArt Play
    };
    for (const [alias, canonical] of Object.entries(expected)) {
      expect(canonicalProviderId(Number(alias))).toBe(canonical);
    }
  });
  it('passes through ids that are already canonical / unknown', () => {
    expect(canonicalProviderId(8)).toBe(8);     // Netflix (no alias)
    expect(canonicalProviderId(489)).toBe(489); // already canonical
  });
});

describe('availableStateDocId (BIN-523)', () => {
  it('gives movie N and TV N DISTINCT state ids — TMDB ids are independent per media type', () => {
    expect(availableStateDocId('movie', 603)).toBe('movie_603');
    expect(availableStateDocId('tv', 603)).toBe('tv_603');
    expect(availableStateDocId('movie', 603)).not.toBe(availableStateDocId('tv', 603));
  });

  it('normalizes unknown/blank mediaType to tv (matches the fetch/actionUrl fallback)', () => {
    expect(availableStateDocId('', 42)).toBe('tv_42');
    expect(availableStateDocId('weird', 42)).toBe('tv_42');
  });
});

describe('normalizeMediaType (BIN-523)', () => {
  it('passes movie/tv through and falls back to tv otherwise', () => {
    expect(normalizeMediaType('movie')).toBe('movie');
    expect(normalizeMediaType('tv')).toBe('tv');
    expect(normalizeMediaType('')).toBe('tv');
  });
});

// BIN-529: a user holding movie N and TV N must get two independent inbox
// entries when both gain the same provider — not one merge-overwritten card.
// The scheduled function itself can't run under the root (admin-free) vitest
// suite (see functions/src's admin-import exclusion), so this pins the
// namespaced-key contract that guarantees the two writes never collide,
// which is the actual mechanism the "two independent entries" behavior rests on.
describe('inboxNotifId (BIN-529)', () => {
  it('gives movie N and TV N DISTINCT inbox doc ids for the same provider — no merge-overwrite', () => {
    const movieId = inboxNotifId('movie', 603, 8);
    const tvId = inboxNotifId('tv', 603, 8);
    expect(movieId).toBe('movie_603-8');
    expect(tvId).toBe('tv_603-8');
    expect(movieId).not.toBe(tvId);
  });

  it('rides availableStateDocId so the inbox key stays in lockstep with the state/tag key', () => {
    expect(inboxNotifId('movie', 27205, 337)).toBe(`${availableStateDocId('movie', 27205)}-337`);
  });
});

describe('diffNewProviders (BIN-60)', () => {
  it('returns [] on first observation (last === null) — baseline, no first-run blast', () => {
    expect(diffNewProviders([8, 119], null)).toEqual([]);
  });

  it('returns only providers added since last observation', () => {
    expect(diffNewProviders([8, 119, 76], [8, 119])).toEqual([76]);
  });

  it('returns [] when nothing was added (even if some were removed)', () => {
    expect(diffNewProviders([8], [8, 119])).toEqual([]);
  });

  it('returns [] when current equals last (no change)', () => {
    expect(diffNewProviders([8, 119], [8, 119])).toEqual([]);
  });

  it('returns [] when the title left all providers (empty current)', () => {
    expect(diffNewProviders([], [8, 119])).toEqual([]);
  });
});

describe('qualifyingProviders (BIN-60)', () => {
  const on = { availableOnMyServices: true, pushEnabled: true };

  it('returns the new providers the user subscribes to', () => {
    expect(qualifyingProviders(on, [76, 8], [8])).toEqual([8]);
  });

  it('returns [] when none of the new providers are the user\'s', () => {
    expect(qualifyingProviders(on, [76], [8, 119])).toEqual([]);
  });

  it('returns [] when availableOnMyServices is off', () => {
    expect(qualifyingProviders({ availableOnMyServices: false, pushEnabled: true }, [8], [8])).toEqual([]);
  });

  it('returns [] when pushEnabled is off', () => {
    expect(qualifyingProviders({ availableOnMyServices: true, pushEnabled: false }, [8], [8])).toEqual([]);
  });

  it('returns [] when settings is null (user-doc missing)', () => {
    expect(qualifyingProviders(null, [8], [8])).toEqual([]);
  });
});
