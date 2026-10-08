import { describe, it, expect } from 'vitest';
import {
  SWEDISH_PROVIDERS,
  PROVIDER_MAP,
  getProvider,
  canonicalProviderId,
  getProviderColor,
  hasFreeProvider,
  dedupeProvidersByCanonicalId,
  resolveProviderMonthlyCost,
} from './providers';
// BIN-814: the SE extraction moved out of providers.ts. The canonicalisation cases
// below still belong here — they are about THIS module's alias map — so they drive
// it through the helper that now owns the flatrate/free/ads categories.
import { seSubscriptionProviderIdsForRefresh } from './seProviderIds';

describe('SWEDISH_PROVIDERS catalog', () => {
  it('has at least the core Swedish streaming services', () => {
    const ids = SWEDISH_PROVIDERS.map(p => p.id);
    // Netflix, Prime, Disney+, HBO, Viaplay, SVT, TV4, Apple TV+
    expect(ids).toContain(8);    // Netflix
    expect(ids).toContain(119);  // Amazon Prime
    expect(ids).toContain(337);  // Disney+
    expect(ids).toContain(384);  // HBO Max
    expect(ids).toContain(76);   // Viaplay
    expect(ids).toContain(520);  // SVT Play
    expect(ids).toContain(489);  // TV4 Play (canonical id)
    expect(ids).toContain(350);  // Apple TV+
  });

  it('every flatrate provider has a non-negative default monthly cost', () => {
    for (const p of SWEDISH_PROVIDERS) {
      if (p.type === 'flatrate' && p.defaultMonthlyCost !== undefined) {
        expect(p.defaultMonthlyCost).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('every provider has a brand color in hex', () => {
    for (const p of SWEDISH_PROVIDERS) {
      expect(p.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('every tier id is unique within its provider', () => {
    for (const p of SWEDISH_PROVIDERS) {
      if (!p.tiers) continue;
      const tierIds = p.tiers.map(t => t.id);
      const unique = new Set(tierIds);
      expect(tierIds.length).toBe(unique.size);
    }
  });
});

describe('canonicalProviderId', () => {
  it('returns the canonical id for an alias (TV4 Play: 1944 → 489)', () => {
    expect(canonicalProviderId(1944)).toBe(489);
  });

  it('returns the same id for a canonical id', () => {
    expect(canonicalProviderId(489)).toBe(489);
    expect(canonicalProviderId(8)).toBe(8);   // Netflix
    expect(canonicalProviderId(337)).toBe(337); // Disney+
  });

  it('returns the input unchanged for unknown ids', () => {
    expect(canonicalProviderId(99999)).toBe(99999);
    expect(canonicalProviderId(0)).toBe(0);
  });
});

describe('getProvider', () => {
  it('finds a provider by canonical id', () => {
    expect(getProvider(8)?.name).toBe('Netflix');
    expect(getProvider(489)?.name).toBe('TV4 Play');
  });

  it('finds a provider by alias id', () => {
    // TV4 Play alias 1944 → same provider as 489
    expect(getProvider(1944)?.name).toBe('TV4 Play');
    expect(getProvider(1944)?.id).toBe(489);  // always returns canonical struct
  });

  it('returns undefined for unknown ids', () => {
    expect(getProvider(99999)).toBeUndefined();
  });
});

describe('getProviderColor', () => {
  it('returns the color for a known provider', () => {
    expect(getProviderColor(8)).toBe('#E50914'); // Netflix red
  });

  it('returns the canonical provider\'s color for an alias', () => {
    // alias 1944 resolves to TV4 Play (489) whose color is #E2001A
    expect(getProviderColor(1944)).toBe('#E2001A');
  });

  it('returns a fallback grey for unknown ids', () => {
    expect(getProviderColor(99999)).toBe('#888');
  });
});

// BIN-814: the absent-vs-empty cases that used to live here moved to
// seProviderIds.test.ts along with the extraction — and the expected value CHANGED
// (an absent SE block is `undefined` now, not `[]`, which is the whole fix). What
// stays here is what this module still owns: that the alias map collapses correctly
// when a real SE payload is run through it.
describe('SE extraction through this module\'s alias map', () => {
  it('combines flatrate + free + ads', () => {
    const result = seSubscriptionProviderIdsForRefresh({
      'watch/providers': {
        results: {
          SE: {
            flatrate: [{ provider_id: 8 }],   // Netflix
            free: [{ provider_id: 520 }],     // SVT Play
            ads: [{ provider_id: 337 }],      // Disney+
          },
        },
      },
    });
    expect(result).toEqual(expect.arrayContaining([8, 520, 337]));
    expect(result).toHaveLength(3);
  });

  it('canonicalises alias ids (TV4 Play 1944 → 489)', () => {
    const result = seSubscriptionProviderIdsForRefresh({
      'watch/providers': { results: { SE: { flatrate: [{ provider_id: 1944 }] } } },
    });
    expect(result).toEqual([489]);
  });

  it('dedupes when same canonical id appears across categories', () => {
    // En tjänst kan listas både i flatrate och ads (canonical 489 = TV4 Play
    // via både 489 och alias 1944).
    const result = seSubscriptionProviderIdsForRefresh({
      'watch/providers': {
        results: {
          SE: {
            flatrate: [{ provider_id: 489 }],
            ads: [{ provider_id: 1944 }],
          },
        },
      },
    });
    expect(result).toEqual([489]);
  });
});

describe('B1 — HBO Max (id 384), namnet tillbaka efter Max-perioden', () => {
  it('renders id 384 under the name "HBO Max"', () => { expect(getProvider(384)?.name).toBe('HBO Max'); });
  it('keeps the legacy HBO Max alias 1899 mapped to id 384', () => {
    expect(getProvider(1899)?.id).toBe(384); expect(canonicalProviderId(1899)).toBe(384);
  });
  it('lists HBO Max exactly once', () => {
    const named = SWEDISH_PROVIDERS.filter(p => p.name === 'Max' || p.name === 'HBO Max');
    expect(named).toHaveLength(1); expect(named[0].name).toBe('HBO Max');
  });
});
describe('B1 — C More legacy id maps to TV4 Play (id 489)', () => {
  const C_MORE_LEGACY_ID = 1759; // CONFIRM against live TMDB before merge
  it('canonicalises the C More legacy id to TV4 Play (489)', () => { expect(canonicalProviderId(C_MORE_LEGACY_ID)).toBe(489); });
  it('resolves to the TV4 Play struct', () => {
    expect(getProvider(C_MORE_LEGACY_ID)?.id).toBe(489); expect(getProvider(C_MORE_LEGACY_ID)?.name).toBe('TV4 Play');
  });
  it('keeps the existing TV4 Play alias 1944 intact', () => {
    expect(canonicalProviderId(1944)).toBe(489); expect(canonicalProviderId(C_MORE_LEGACY_ID)).toBe(489);
  });
  it('dedupes a title listed under both 489 and C More legacy', () => {
    const result = seSubscriptionProviderIdsForRefresh({ 'watch/providers': { results: { SE: { flatrate: [{ provider_id: 489 }, { provider_id: C_MORE_LEGACY_ID }] } } } });
    expect(result).toEqual([489]);
  });
});

describe('X3 — Amazon Channel-varianter canonicaliseras (live-verifierade SE-ids 2026-06-10)', () => {
  it('mappar HBO Max Amazon Channel (1825) till HBO Max (384)', () => {
    expect(canonicalProviderId(1825)).toBe(384);
    expect(getProvider(1825)?.name).toBe('HBO Max');
  });

  it('mappar Apple TV Amazon Channel (2243) till Apple TV+ (350)', () => {
    expect(canonicalProviderId(2243)).toBe(350);
    expect(getProvider(2243)?.name).toBe('Apple TV+');
  });

  it('mappar Crunchyroll Amazon Channel (1968) till Crunchyroll (323)', () => {
    expect(canonicalProviderId(1968)).toBe(323);
    expect(getProvider(1968)?.name).toBe('Crunchyroll');
  });
});

describe('BIN-64 — provider-katalog SE-completeness (live-verifierat 2026-06-20)', () => {
  it('SF Anytime (426) finns nu som hyr/köp-tjänst', () => {
    const sf = getProvider(426);
    expect(sf?.name).toBe('SF Anytime');
    expect(sf?.type).toBe('rent');
  });

  it('TMDB:s nuvarande bas-id:n canonicaliseras till befintliga katalog-entries', () => {
    // Title-nivå-data använder dessa id:n idag; aliasen gör att de känns igen
    // utan att ändra den primära (sparad data förblir stabil).
    expect(canonicalProviderId(283)).toBe(323);   // Crunchyroll
    expect(canonicalProviderId(493)).toBe(520);   // SVT
    expect(canonicalProviderId(1773)).toBe(431);  // SkyShowtime
    expect(canonicalProviderId(188)).toBe(335);   // YouTube Premium
    expect(canonicalProviderId(497)).toBe(521);   // Tele2 Play
    expect(canonicalProviderId(517)).toBe(578);   // TriArt Play
  });

  it('getProvider resolver de nya alias-id:na till rätt tjänst', () => {
    expect(getProvider(283)?.name).toBe('Crunchyroll');
    expect(getProvider(493)?.name).toBe('SVT Play');
    expect(getProvider(1773)?.name).toBe('SkyShowtime');
  });

  it('seSubscriptionProviderIdsForRefresh känner igen en titel som TMDB listar under nutida id (283 → 323)', () => {
    const result = seSubscriptionProviderIdsForRefresh({
      'watch/providers': { results: { SE: { flatrate: [{ provider_id: 1968 }, { provider_id: 283 }] } } },
    });
    // Både Amazon-kanalen (1968) och bas-id:t (283) → en enda Crunchyroll (323).
    expect(result).toEqual([323]);
  });
});

describe('hasFreeProvider (BIN-90)', () => {
  it('true när listan innehåller en gratis-tjänst (SVT Play 520 + alias 493)', () => {
    expect(hasFreeProvider([8, 520])).toBe(true);  // Netflix + SVT Play
    expect(hasFreeProvider([493])).toBe(true);      // SVT-alias → SVT Play (isFree)
  });
  it('false för enbart betalda tjänster, tom lista, eller okända ids', () => {
    expect(hasFreeProvider([8, 337, 384])).toBe(false); // Netflix/Disney+/Max
    expect(hasFreeProvider([])).toBe(false);
    expect(hasFreeProvider([99999])).toBe(false);
  });
});

describe('X3/T1/SÖ2/M2 — dedupeProvidersByCanonicalId', () => {
  const p = (provider_id: number, provider_name: string, logo_path = '/x.png') =>
    ({ provider_id, provider_name, logo_path });

  it('returnerar tom lista för tom input', () => {
    expect(dedupeProvidersByCanonicalId([])).toEqual([]);
  });

  it('lämnar redan unika providers orörda i samma ordning', () => {
    const list = [p(8, 'Netflix'), p(337, 'Disney+'), p(520, 'SVT Play')];
    expect(dedupeProvidersByCanonicalId(list)).toEqual(list);
  });

  it('dedupar alias-id mot kanoniskt id (Max 384 + HBO Max Amazon Channel 1825)', () => {
    const result = dedupeProvidersByCanonicalId([
      p(384, 'Max'),
      p(1825, 'HBO Max Amazon Channel'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].provider_id).toBe(384);
  });

  it('behåller bas-entryn även när varianten kommer först i listan', () => {
    const result = dedupeProvidersByCanonicalId([
      p(2243, 'Apple TV Amazon Channel'),
      p(350, 'Apple TV+'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].provider_id).toBe(350);
  });

  it('dedupar okända framtida Amazon Channel-varianter via namn-suffix mot bas i listan', () => {
    // 99001/99002 finns inte i SWEDISH_PROVIDERS — fallbacken matchar
    // " Amazon Channel"-suffixet mot basnamnet i samma lista.
    const result = dedupeProvidersByCanonicalId([
      p(99001, 'MGM'),
      p(99002, 'MGM Amazon Channel'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].provider_id).toBe(99001);
  });

  it('hanterar plural-suffixet " Amazon Channels"', () => {
    const result = dedupeProvidersByCanonicalId([
      p(99003, 'Lionsgate+'),
      p(99004, 'Lionsgate+ Amazon Channels'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].provider_id).toBe(99003);
  });

  it('behåller en Amazon Channel-variant vars bas inte finns någonstans', () => {
    // Titeln finns BARA via kanalen — då är kanalen den riktiga tjänsten.
    const result = dedupeProvidersByCanonicalId([p(99005, 'Hayu Amazon Channel')]);
    expect(result).toHaveLength(1);
    expect(result[0].provider_id).toBe(99005);
  });

  it('dedupar variant mot bas i katalogen via namn även utan alias-id', () => {
    // Okänt variant-id men basnamnet matchar en SWEDISH_PROVIDER → kollapsa.
    const result = dedupeProvidersByCanonicalId([
      p(76, 'Viaplay'),
      p(99006, 'Viaplay Amazon Channel'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].provider_id).toBe(76);
  });
});

describe('A3 — enhetligt TV4 Play-namn', () => {
  it('shortName för TV4 Play (489) är "TV4 Play" så alla ytor visar samma namn', () => {
    expect(getProvider(489)?.shortName).toBe('TV4 Play');
    expect(getProvider(489)?.name).toBe('TV4 Play');
  });
});

describe('PROVIDER_MAP', () => {
  it('contains every canonical id', () => {
    for (const p of SWEDISH_PROVIDERS) {
      expect(PROVIDER_MAP.has(p.id)).toBe(true);
    }
  });

  it('contains every alias id mapped to the same provider struct', () => {
    for (const p of SWEDISH_PROVIDERS) {
      if (!p.aliases) continue;
      for (const alias of p.aliases) {
        expect(PROVIDER_MAP.get(alias)).toBe(p);
      }
    }
  });
});

describe('BIN-1400 — YouTube Premium Lite', () => {
  it('has a lite tier named Lite at 99, first in an ascending price list', () => {
    const yt = getProvider(335);
    expect(yt?.tiers?.find(t => t.id === 'lite')).toEqual({ id: 'lite', name: 'Lite', cost: 99 });
    const costs = (yt?.tiers ?? []).map(t => t.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(yt?.tiers?.[0]?.id).toBe('lite');
    expect(yt?.defaultMonthlyCost).toBe(169);
  });

  it('resolves a saved lite choice to 99', () => {
    expect(resolveProviderMonthlyCost(335, { providerTiers: { 335: 'lite' } })).toBe(99);
  });
});

describe('BIN-1401 — MUBI och Draken Film i katalogen, Hayu inte', () => {
  it.each([
    [11, 'MUBI', 'MUBI'],
    [435, 'Draken Film', 'Draken'],
  ])('%i resolves to its own flatrate entry, not free or ads', (id, name, shortName) => {
    const p = getProvider(id);
    expect(p?.id).toBe(id);
    expect(p?.name).toBe(name);
    expect(p?.shortName).toBe(shortName);
    expect(p?.type).toBe('flatrate');
    expect(p?.defaultMonthlyCost).toBeGreaterThan(0);
    expect(canonicalProviderId(id)).toBe(id);
    expect(Boolean(p?.isFree)).toBe(false);
    expect(Boolean(p?.isAds)).toBe(false);
    expect(hasFreeProvider([id])).toBe(false);
  });

  it('Draken Film har nivåerna Bas, Standard och Premium i stigande pris (BIN-1418)', () => {
    const draken = getProvider(435);
    expect(draken?.tiers).toEqual([
      { id: 'bas', name: 'Bas', cost: 95 },
      { id: 'standard', name: 'Standard', cost: 125 },
      { id: 'premium', name: 'Premium', cost: 165 },
    ]);
    expect(draken?.defaultMonthlyCost).toBe(125);
    expect(resolveProviderMonthlyCost(435, { providerTiers: { 435: 'bas' } })).toBe(95);
  });

  it('Hayu (223) is not in the catalog', () => {
    expect(getProvider(223)).toBeUndefined();
  });
});
