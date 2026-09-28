import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BundleSuggestion, SwedishBundle } from '@/types';
import BundleArbitrageCard from './BundleArbitrageCard';

// Pure render test (like ListCheapestPlanPanel): the card takes already-computed
// BundleSuggestion[] from the engine, so we feed fixed suggestions and assert the
// card is HONEST about them — the whole point of role #28's bar.

function bundle(over: Partial<SwedishBundle> = {}): SwedishBundle {
  return {
    id: 'telia-mer',
    name: 'Telia Streaming Mer',
    vendor: 'Telia',
    monthlyKr: 269,
    includedProviderIds: [8, 384, 337],
    verifiedDate: '2026-07-07',
    url: 'https://www.telia.se/tv/streaming/streaming-mer',
    ...over,
  };
}

function suggestion(over: Partial<BundleSuggestion> = {}): BundleSuggestion {
  return {
    bundle: bundle(),
    replacedProviderIds: [8, 384],
    replacedNames: ['Netflix', 'Max'],
    currentKr: 327,
    bundleKr: 269,
    bindingMonths: 0,
    startFeeKr: 0,
    startFeeMonthlyKr: 0,
    commitmentTotalKr: null,
    savingKr: 58,
    bonusProviderIds: [337],
    bonusNames: ['Disney+'],
    downgradeProviderIds: [],
    downgradeNames: [],
    stale: false,
    ...over,
  };
}

describe('BundleArbitrageCard (BIN-430)', () => {
  it('renders nothing when there are no suggestions', () => {
    const { container } = render(<BundleArbitrageCard suggestions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the bundle, the replaced à-la-carte set, both prices and the saving', () => {
    render(<BundleArbitrageCard suggestions={[suggestion()]} />);
    expect(
      screen.getByText('Dina lösa tjänster kan bli billigare i ett paket'),
    ).toBeInTheDocument();
    // Bundle name appears in the header row + the sentence.
    expect(screen.getAllByText(/Telia Streaming Mer/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('spara 58 kr/mån')).toBeInTheDocument();
    expect(
      screen.getByText(/Du betalar 327 kr\/mån för Netflix och Max var för sig/),
    ).toBeInTheDocument();
    expect(screen.getByText(/för 269 kr\/mån/)).toBeInTheDocument();
  });

  it('shows bonus services qualitatively and never priced or folded into the saving', () => {
    render(<BundleArbitrageCard suggestions={[suggestion()]} />);
    const bonus = screen.getByText(/Ingår dessutom: Disney\+/);
    expect(bonus).toBeInTheDocument();
    // Honesty: the bonus line explicitly disclaims it's not in the saving, and it
    // carries no "kr" price of its own.
    expect(bonus).toHaveTextContent(/inte inräknat i besparingen/);
    expect(bonus.textContent).not.toMatch(/kr/);
  });

  it('shows downgraded services qualitatively (never as a saving)', () => {
    render(
      <BundleArbitrageCard
        suggestions={[
          suggestion({ downgradeProviderIds: [337], downgradeNames: ['Disney+'], bonusNames: [], bonusProviderIds: [] }),
        ]}
      />,
    );
    const dg = screen.getByText(/Disney\+ ingår men i en lägre nivå än du har idag/);
    expect(dg).toBeInTheDocument();
    expect(dg.textContent).not.toMatch(/kr/);
  });

  it('surfaces the stale-price caveat when the bundle is stale (role #28 must-have)', () => {
    render(<BundleArbitrageCard suggestions={[suggestion({ stale: true })]} />);
    expect(screen.getByText(/Priser verifierade .* — kan vara inaktuella/)).toBeInTheDocument();
  });

  it('shows a plain verified-date line (no stale warning) when fresh', () => {
    render(<BundleArbitrageCard suggestions={[suggestion({ stale: false })]} />);
    expect(screen.getByText(/Priser verifierade/)).toBeInTheDocument();
    expect(screen.queryByText(/kan vara inaktuella/)).not.toBeInTheDocument();
  });

  it('renders multiple suggestions best-first and frames them as mutually exclusive', () => {
    const best = suggestion({ bundle: bundle({ id: 'a', name: 'Paket A' }), savingKr: 120 });
    const second = suggestion({ bundle: bundle({ id: 'b', name: 'Paket B' }), savingKr: 40 });
    render(<BundleArbitrageCard suggestions={[best, second]} />);
    // Mutually-exclusive hint appears only with >1 option.
    expect(screen.getByText(/gäller inte tillsammans/)).toBeInTheDocument();
    // Order preserved: the engine sorts best-first; the card must not reorder.
    const savings = screen.getAllByText(/spara \d+ kr\/mån/).map(n => n.textContent);
    expect(savings).toEqual(['spara 120 kr/mån', 'spara 40 kr/mån']);
  });

  describe('binding period and start fee (BIN-1335)', () => {
    const withFee = () =>
      suggestion({
        bundle: bundle({ id: 'allente-premium', name: 'Allente Premium', vendor: 'Allente', monthlyKr: 899 }),
        bundleKr: 899,
        currentKr: 1095,
        bindingMonths: 12,
        startFeeKr: 695,
        startFeeMonthlyKr: 58,
        commitmentTotalKr: 11_483,
        savingKr: 138,
      });

    it('states binding, the start fee in kronor and its "räknad som" share on one line', () => {
      render(<BundleArbitrageCard suggestions={[withFee()]} />);
      const box = screen.getByTestId('bundle-commitment');
      expect(box).toHaveTextContent(
        '12 mån bindningstid · startavgift 695 kr (räknad som 58 kr/mån i besparingen)',
      );
    });

    it('shows the total for the whole binding period', () => {
      render(<BundleArbitrageCard suggestions={[withFee()]} />);
      expect(screen.getByTestId('bundle-commitment')).toHaveTextContent(
        /Totalt under bindningstiden: 11\s483 kr/,
      );
    });

    it('sits directly under the headline, before the explanation — never tucked away', () => {
      render(<BundleArbitrageCard suggestions={[withFee()]} />);
      const box = screen.getByTestId('bundle-commitment');
      const headline = screen.getByText('spara 138 kr/mån').parentElement!;
      expect(headline.nextElementSibling).toBe(box);
      expect(box.nextElementSibling).toHaveTextContent(/^Du betalar 1095 kr\/mån/);
    });

    it('the "räknad som" figure is the same number the saving deducted', () => {
      const s = withFee();
      render(<BundleArbitrageCard suggestions={[s]} />);
      expect(s.currentKr - s.bundleKr - s.startFeeMonthlyKr).toBe(s.savingKr);
      expect(screen.getByTestId('bundle-commitment')).toHaveTextContent(`räknad som ${s.startFeeMonthlyKr} kr/mån`);
    });

    it('a fee without binding shows the fee but no binding and no total', () => {
      render(
        <BundleArbitrageCard
          suggestions={[suggestion({ startFeeKr: 120, startFeeMonthlyKr: 10, savingKr: 48 })]}
        />,
      );
      const box = screen.getByTestId('bundle-commitment');
      expect(box).toHaveTextContent('Startavgift 120 kr (räknad som 10 kr/mån i besparingen)');
      expect(box).not.toHaveTextContent(/bindningstid/);
    });

    it('bundles with neither show no extra line at all', () => {
      render(<BundleArbitrageCard suggestions={[suggestion()]} />);
      expect(screen.queryByTestId('bundle-commitment')).toBeNull();
    });
  });
});
