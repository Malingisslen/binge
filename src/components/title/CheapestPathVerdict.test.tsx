// src/components/title/CheapestPathVerdict.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, getDefaultNormalizer } from '@testing-library/react';
import { CheapestPathVerdict } from './CheapestPathVerdict';
import type { Offer } from '@/lib/streaming/offers';

// BIN-1373: formatKr's own test proves the helper groups thousands, but not that
// this surface calls it. A regression to a raw `${v.priceAmount}` would print
// "1299" and stay green there.
describe('CheapestPathVerdict — kronbelopp grupperas i tusental (BIN-1373)', () => {
  const NBSP = ' ';
  // The default normalizer collapses every \s run, NBSP included, to a plain
  // space; keep whitespace verbatim so the assertion sees the separator itself.
  const exact = { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) };

  it('skriver ett fyrsiffrigt hyrpris med tusentalsavgränsare', () => {
    const offers: Offer[] = [
      { providerId: 2, type: 'rent', link: 'https://example.test', priceAmount: 1299, priceCurrency: 'SEK', leaving: null },
    ];
    render(
      <CheapestPathVerdict
        subscriptionProviderIds={[]}
        ownedProviderIds={[]}
        offers={offers}
        libraryAvailable={false}
      />,
    );

    expect(screen.getByText(`Billigast: hyr för 1${NBSP}299 kr på Apple TV`, exact)).toBeInTheDocument();
  });
});
