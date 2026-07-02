import { describe, it, expect } from 'vitest';
import { readableTextColor, splitProviders, totalMonthlyCost } from './ProvidersSection.helpers';
import type { SwedishProvider } from '@/lib/tmdb/providers';

describe('readableTextColor', () => {
  it('returns white on dark brand colors', () => {
    expect(readableTextColor('#E50914')).toBe('white'); // Netflix red
    expect(readableTextColor('#0063E5')).toBe('white'); // Disney+ blue
    expect(readableTextColor('#000000')).toBe('white');
  });

  it('returns ink on light brand colors', () => {
    expect(readableTextColor('#FFFFFF')).toBe('ink');
    expect(readableTextColor('#FFD400')).toBe('ink'); // bright yellow
  });

  it('returns ink on mid-luminance brand colors (WCAG AA needs dark text)', () => {
    expect(readableTextColor('#00A8E1')).toBe('ink'); // Amazon Prime cyan
    expect(readableTextColor('#FF6B00')).toBe('ink'); // Viaplay orange
    expect(readableTextColor('#FF0000')).toBe('ink'); // YouTube red
  });

  it('handles 3-digit hex and missing #', () => {
    expect(readableTextColor('fff')).toBe('ink');
    expect(readableTextColor('000')).toBe('white');
  });
});

const P = (id: number, name: string): SwedishProvider =>
  ({ id, name, shortName: name, color: '#000', type: 'flatrate' });

describe('splitProviders', () => {
  const all = [P(8, 'Netflix'), P(337, 'Disney+'), P(489, 'TV4 Play')];

  it('splits selected (in selection order) from available (in source order)', () => {
    const { selected, available } = splitProviders(all, [489, 8]);
    expect(selected.map(p => p.id)).toEqual([489, 8]);
    expect(available.map(p => p.id)).toEqual([337]);
  });

  it('matches via canonical id so aliases do not duplicate', () => {
    // 1944 is an alias of 489 (TV4 Play)
    const { selected, available } = splitProviders(all, [1944]);
    expect(selected.map(p => p.id)).toEqual([489]);
    expect(available.map(p => p.id)).toEqual([8, 337]);
  });

  it('ignores selected ids with no matching provider', () => {
    const { selected } = splitProviders(all, [99999]);
    expect(selected).toEqual([]);
  });

  it('dedupes when both an id and its alias are selected', () => {
    const { selected } = splitProviders(all, [489, 1944]);
    expect(selected.map(p => p.id)).toEqual([489]);
  });
});

describe('totalMonthlyCost', () => {
  it('sums costs for selected ids only', () => {
    expect(totalMonthlyCost([8, 489], { 8: 109, 489: 69, 337: 159 })).toBe(178);
  });
  it('falls back to the catalog default for a selected provider with no entered cost', () => {
    // Tier-first resolution: a selected provider the user hasn't priced still costs
    // money, so it contributes its defaultMonthlyCost — matching what the advisor
    // sums (they must never disagree). Here 8→109 (custom) + 489→169 (TV4 default).
    expect(totalMonthlyCost([8, 489], { 8: 109 })).toBe(278);
  });
  it('uses the live tier price for a chosen tier, ignoring a stale providerCosts entry', () => {
    // A tier user's frozen providerCosts is migrated away; even if a stale 999
    // lingered, the total tracks the current catalog tier price (Netflix Standard 169).
    expect(totalMonthlyCost([8], { 8: 999 }, { 8: 'standard' })).toBe(169);
  });
  it('is 0 for empty selection', () => {
    expect(totalMonthlyCost([], { 8: 109 })).toBe(0);
  });
  it('collapses an alias+canonical pair so a service is not double-counted (BIN-409)', () => {
    // 531 (Paramount+, now a SkyShowtime alias) + 431 (SkyShowtime) → 109 once, not 218.
    expect(totalMonthlyCost([531, 431], {}, {})).toBe(109);
  });
  it('resolves alias ids against canonical cost keys', () => {
    expect(totalMonthlyCost([1944], { 489: 69 })).toBe(69);
  });
});
