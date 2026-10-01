// src/components/title/CheapestPathVerdict.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CheapestPathVerdict as Verdict } from '@/lib/streaming/cheapestPath';
import type { Offer } from '@/lib/streaming/offers';
import { krText, verbatim } from '@/test/krText';

// The subscribe branch prices from the provider catalog, where no tier reaches
// four digits, so a verdict for it is injected here. The rent test runs the
// real cheapestPath.
const verdict = vi.hoisted(() => ({ override: null as Verdict | null }));

vi.mock('@/lib/streaming/cheapestPath', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/streaming/cheapestPath')>();
  return {
    ...actual,
    cheapestPath: (input: Parameters<typeof actual.cheapestPath>[0]) =>
      verdict.override ?? actual.cheapestPath(input),
  };
});

import { CheapestPathVerdict } from './CheapestPathVerdict';

afterEach(() => {
  verdict.override = null;
});

// BIN-1373: formatKr's own test proves the helper groups thousands, but not that
// this surface calls it. A regression to a raw `${v.priceAmount}` would print
// "1299" and stay green there.
describe('CheapestPathVerdict — kronbelopp grupperas i tusental (BIN-1373)', () => {
  const renderVerdict = (offers: Offer[] = []) =>
    render(
      <CheapestPathVerdict
        subscriptionProviderIds={[]}
        ownedProviderIds={[]}
        offers={offers}
        libraryAvailable={false}
      />,
    );

  it('skriver ett fyrsiffrigt hyrpris med tusentalsavgränsare', () => {
    renderVerdict([
      { providerId: 2, type: 'rent', link: 'https://example.test', priceAmount: 1299, priceCurrency: 'SEK', leaving: null },
    ]);

    expect(screen.getByText(krText('Billigast: hyr för 1 299 kr på Apple TV'), verbatim)).toBeInTheDocument();
  });

  // BIN-1375: the two subscribe branches, with and without a tier label.
  it('skriver ett fyrsiffrigt abonnemangspris med nivånamn med tusentalsavgränsare', () => {
    verdict.override = {
      kind: 'subscribe', providerId: 8, priceAmount: 1049, priceCurrency: 'SEK',
      tierLabel: 'Standard med reklam', loansLeft: null,
    };
    renderVerdict();

    expect(
      screen.getByText(krText('Billigaste väg: Netflix från 1 049 kr/mån (Standard med reklam)'), verbatim),
    ).toBeInTheDocument();
  });

  it('skriver ett fyrsiffrigt abonnemangspris utan nivånamn med tusentalsavgränsare', () => {
    verdict.override = {
      kind: 'subscribe', providerId: 8, priceAmount: 1049, priceCurrency: 'SEK',
      tierLabel: null, loansLeft: null,
    };
    renderVerdict();

    expect(screen.getByText(krText('Billigaste väg: Netflix 1 049 kr/mån'), verbatim)).toBeInTheDocument();
  });
});
