import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GuestBundleBox from './GuestBundleBox';

// toHaveTextContent collapses the received text's whitespace (sv-SE groups with a
// no-break space) but not the expected string's, so expected numbers go through this.
const kr = (n: number) => n.toLocaleString('sv-SE').replace(/\s/g, ' ');
import { detectBundleArbitrage, type SwedishBundle } from '@/lib/advisor/bundleArbitrage';

// #28:s villkor 9 — the box shows savingKr as the engine returns it, binding, start
// fee with its "räknad som" share, the stale caveat and downgrades. Every suggestion
// here comes out of the real engine over a fixture bundle, so the numbers asserted
// are the engine's, not this file's.

const NOW = new Date(2026, 9, 5);

function suggestionFor(bundle: SwedishBundle, tiers: Record<number, string>) {
  const ids = Object.keys(tiers).map(Number);
  const [s] = detectBundleArbitrage(ids, { providerTiers: tiers }, [bundle], NOW);
  if (!s) throw new Error('fixture produced no suggestion');
  return s;
}

const base: SwedishBundle = {
  id: 'fixture', name: 'Testpaketet', vendor: 'Testbolaget', monthlyKr: 100,
  includedProviderIds: [384, 337], includedTiers: { 384: 'ads', 337: 'ads' },
  bindingMonths: 0, startFeeKr: 0, verifiedDate: '2026-09-28', url: 'https://example.se',
};

describe('GuestBundleBox', () => {
  it('shows the bundle, the replaced services and savingKr per month and year, never "du betalar"', () => {
    const s = suggestionFor(base, { 384: 'ads', 337: 'ads' });
    render(<GuestBundleBox suggestion={s} estimated={false} />);
    const box = screen.getByTestId('guest-bundle');
    expect(box).toHaveTextContent('Billigare som paket');
    expect(box).toHaveTextContent(`Testpaketet har HBO Max och Disney+ för 100 kr/mån.`);
    expect(box).toHaveTextContent(`Du sparar ${kr(s.savingKr)} kr/mån (${kr(s.savingKr * 12)} kr/år).`);
    expect(box).toHaveTextContent('Ingen bindningstid · ingen startavgift.');
    expect(box.textContent?.toLowerCase()).not.toContain('du betalar');
  });

  it('says "uppskattningsvis" when a replaced service is at list price', () => {
    const s = suggestionFor(base, { 384: 'ads', 337: 'ads' });
    render(<GuestBundleBox suggestion={s} estimated />);
    expect(screen.getByTestId('guest-bundle')).toHaveTextContent('Du sparar uppskattningsvis');
  });

  it('shows binding, start fee and the "räknad som" share from the engine', () => {
    const s = suggestionFor({ ...base, bindingMonths: 12, startFeeKr: 120 }, { 384: 'ads', 337: 'ads' });
    expect(s.startFeeMonthlyKr).toBe(10); // 120 / 12, rounded up by the engine
    render(<GuestBundleBox suggestion={s} estimated={false} />);
    const box = screen.getByTestId('guest-bundle');
    expect(box).toHaveTextContent('12 mån bindningstid · startavgift 120 kr, räknad som 10 kr/mån i besparingen.');
    expect(box).toHaveTextContent(`Totalt under bindningstiden: ${kr(s.commitmentTotalKr!)} kr.`);
  });

  it('warns when the bundle prices are stale', () => {
    const s = suggestionFor({ ...base, verifiedDate: '2025-01-15' }, { 384: 'ads', 337: 'ads' });
    expect(s.stale).toBe(true);
    render(<GuestBundleBox suggestion={s} estimated={false} />);
    expect(screen.getByTestId('guest-bundle')).toHaveTextContent('Priser verifierade 15 jan 2025, kan vara inaktuella.');
  });

  it('a fresh bundle carries no stale caveat', () => {
    const s = suggestionFor(base, { 384: 'ads', 337: 'ads' });
    render(<GuestBundleBox suggestion={s} estimated={false} />);
    const box = screen.getByTestId('guest-bundle');
    expect(box).toHaveTextContent('Priser verifierade 28 sep 2026.');
    expect(box).not.toHaveTextContent('inaktuella');
  });

  it('names a service the bundle carries at a lower tier', () => {
    const withNetflix: SwedishBundle = {
      ...base, includedProviderIds: [8, 384, 337], includedTiers: { 8: 'standard', 384: 'ads', 337: 'ads' },
    };
    const s = suggestionFor(withNetflix, { 8: 'premium', 384: 'ads', 337: 'ads' });
    expect(s.downgradeNames).toEqual(['Netflix']);
    render(<GuestBundleBox suggestion={s} estimated={false} />);
    expect(screen.getByTestId('guest-bundle')).toHaveTextContent('Ingår men i lägre nivå: Netflix.');
  });
});
