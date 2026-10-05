import { describe, it, expect } from 'vitest';
import { cappedCoreIds, SEO_TITLE_TARGET_IDS, SEO_CORE_DISCOVER_PAGES, SEO_CORE_DISCOVER_PARAMS } from './seoCoverage';
import { SELECTION_ABSOLUTE_FLOOR, SELECTION_CEILING } from './selectionManifest';

describe('cappedCoreIds', () => {
  it('dedupar och behåller första förekomsten', () => {
    const result = cappedCoreIds([10, 20, 10, 30, 20]);
    expect(result).toEqual([10, 20, 30]);
  });

  it('kapar till SEO_TITLE_TARGET_IDS och tar de första, i popularitetsordning', () => {
    const ids = Array.from({ length: SEO_TITLE_TARGET_IDS + 500 }, (_, i) => i);
    const result = cappedCoreIds(ids);
    expect(result.length).toBe(SEO_TITLE_TARGET_IDS);
    expect(result[0]).toBe(0);
    expect(result[SEO_TITLE_TARGET_IDS - 1]).toBe(SEO_TITLE_TARGET_IDS - 1);
  });

  it('hanterar en tom härledning', () => {
    expect(cappedCoreIds([])).toEqual([]);
  });
});

describe('kärnans härledning (ADR 0024)', () => {
  it('ger plats åt målet även om en del titlar filtreras bort', () => {
    expect(SEO_CORE_DISCOVER_PAGES * 20).toBeGreaterThan(SEO_TITLE_TARGET_IDS);
  });

  // Ett kallt bygge där TMDB stryper ungefär hälften av listsidorna ska ändå nå
  // golvet. Faktorn två är marginalen för titlar skriftsystemsfiltret tar bort.
  it('hälften av listsidorna räcker till dubbla golvet för båda mediatyperna', () => {
    const halfPagesRaw = (SEO_CORE_DISCOVER_PAGES / 2) * 20;
    expect(halfPagesRaw).toBeGreaterThanOrEqual(2 * SELECTION_ABSOLUTE_FLOOR.movie);
    expect(halfPagesRaw).toBeGreaterThanOrEqual(2 * SELECTION_ABSOLUTE_FLOOR.tv);
  });

  it('kräver en svensk tjänst, inklusive hyra och köp', () => {
    expect(SEO_CORE_DISCOVER_PARAMS.with_watch_monetization_types.split('|').sort()).toEqual(
      ['ads', 'buy', 'flatrate', 'free', 'rent'],
    );
  });

  it('TAK > HÄRLEDNING för båda mediatyperna, annars blir spärrhaken en nolloperation', () => {
    expect(SELECTION_CEILING.movie).toBeGreaterThan(SEO_TITLE_TARGET_IDS);
    expect(SELECTION_CEILING.tv).toBeGreaterThan(SEO_TITLE_TARGET_IDS);
  });
});
