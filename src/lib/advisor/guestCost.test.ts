import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The two engines are wrapped, not replaced: every assertion below runs against the
// real arithmetic, and the spies only record WHAT guestCost passes in (#28's
// condition 8 is about the argument, not the result).
vi.mock('@/lib/advisor/costEstimate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/advisor/costEstimate')>();
  return { ...actual, summarizeMonthlySpend: vi.fn(actual.summarizeMonthlySpend) };
});
vi.mock('@/lib/advisor/bundleArbitrage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/advisor/bundleArbitrage')>();
  return { ...actual, detectBundleArbitrage: vi.fn(actual.detectBundleArbitrage) };
});

import { computeGuestCost } from './guestCost';
import { summarizeMonthlySpend, isEstimatedMonthlyCost } from '@/lib/advisor/costEstimate';
import { detectBundleArbitrage, SWEDISH_BUNDLES, type SwedishBundle } from '@/lib/advisor/bundleArbitrage';
import { getProvider } from '@/lib/tmdb/providers';

const NOW = new Date(2026, 9, 5);

beforeEach(() => {
  vi.mocked(summarizeMonthlySpend).mockClear();
  vi.mocked(detectBundleArbitrage).mockClear();
});

describe('computeGuestCost — totals come from summarizeMonthlySpend', () => {
  it('"Vet inte" is estimated at the catalog list price (#28 condition 7)', () => {
    const r = computeGuestCost({ 8: null }, NOW);
    expect(r.totalKr).toBe(getProvider(8)!.defaultMonthlyCost);
    expect(r.estimated).toBe(true);
    expect(isEstimatedMonthlyCost(8, {}, NOW)).toBe(true);
  });

  it('a chosen tier is NOT estimated and uses that tier', () => {
    const r = computeGuestCost({ 8: 'basic' }, NOW);
    expect(r.totalKr).toBe(getProvider(8)!.tiers!.find(t => t.id === 'basic')!.cost);
    expect(r.estimated).toBe(false);
  });

  it('a mix with one "Vet inte" is estimated; yearly is twelve months; paidCount counts services', () => {
    const r = computeGuestCost({ 8: 'basic', 119: null }, NOW);
    const expected = summarizeMonthlySpend([8, 119], { providerTiers: { 8: 'basic' } }, NOW);
    expect(r.totalKr).toBe(expected.totalKr);
    expect(r.yearlyKr).toBe(expected.totalKr * 12);
    expect(r.paidCount).toBe(2);
    expect(r.estimated).toBe(true);
  });

  it('an empty selection is zero, not estimated, no bundle', () => {
    expect(computeGuestCost({}, NOW)).toEqual({
      totalKr: 0, yearlyKr: 0, paidCount: 0, estimated: false, bundle: null, bundleEstimated: false,
    });
  });
});

describe('computeGuestCost — only providerTiers is passed on (#28 condition 8)', () => {
  it('hands both engines a settings object with providerTiers and nothing else', () => {
    computeGuestCost({ 8: 'standard', 384: 'ads', 337: null }, NOW);
    const spendSettings = vi.mocked(summarizeMonthlySpend).mock.calls[0][1];
    const bundleSettings = vi.mocked(detectBundleArbitrage).mock.calls[0][1];
    for (const settings of [spendSettings, bundleSettings]) {
      expect(Object.keys(settings)).toEqual(['providerTiers']);
      expect(settings.providerTiers).toEqual({ 8: 'standard', 384: 'ads' });
    }
  });

  it('guestCost.ts carries no price arithmetic of its own (source scan)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/advisor/guestCost.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).toContain('summarizeMonthlySpend('); // the scan reads the real file
    expect(src).not.toMatch(/defaultMonthlyCost/);
    expect(src).not.toMatch(/\.cost\b/);
    expect(src).not.toMatch(/\+=/);
    expect(src).not.toMatch(/\.reduce\(/);
    expect(src).not.toMatch(/resolve(Effective|Provider)MonthlyCost/);
  });
});

describe('computeGuestCost — bundles come from detectBundleArbitrage', () => {
  it('returns the best saving exactly as the engine returns it', () => {
    const selection = { 8: 'standard', 384: 'ads', 337: 'ads' };
    const r = computeGuestCost(selection, NOW);
    const engine = detectBundleArbitrage([8, 384, 337], { providerTiers: selection }, SWEDISH_BUNDLES, NOW);
    expect(engine.length).toBeGreaterThan(0); // the case under test really has a bundle
    expect(r.bundle).toEqual(engine[0]);
    expect(r.bundleEstimated).toBe(false);
  });

  it('marks the bundle estimated when a replaced service is at list price', () => {
    // Prime has no tiers, so it is always list price — and Telia Mest replaces it.
    const r = computeGuestCost({ 8: null, 119: null, 489: null, 76: null }, NOW);
    expect(r.bundle).not.toBeNull();
    expect(r.bundle!.replacedProviderIds).toContain(119);
    expect(r.bundleEstimated).toBe(true);
  });

  it('passes the stale flag through for an old bundle', () => {
    const old: SwedishBundle = {
      id: 'fixture-old', name: 'Gammalt paket', vendor: 'Test', monthlyKr: 100,
      includedProviderIds: [384, 337], includedTiers: { 384: 'ads', 337: 'ads' },
      bindingMonths: 0, startFeeKr: 0, verifiedDate: '2025-01-01',
    };
    const r = computeGuestCost({ 384: 'ads', 337: 'ads' }, NOW, [old]);
    expect(r.bundle?.bundle.id).toBe('fixture-old');
    expect(r.bundle?.stale).toBe(true);
  });
});
