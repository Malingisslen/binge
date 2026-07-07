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
});
