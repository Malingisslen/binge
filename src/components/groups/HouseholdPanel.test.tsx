import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { HouseholdContribution } from '@/lib/advisor/householdAggregate';
import { krText, verbatim } from '@/test/krText';

// BIN-1375: formatKr's own test proves the helper groups thousands, but not that
// this panel calls it. A regression to a raw `{overview.totalKr}` would print
// "2734" and stay green everywhere else.

const NOW = Date.UTC(2026, 8, 30, 12);

const household = vi.hoisted(() => ({
  contributions: [] as HouseholdContribution[],
  status: 'active' as 'active' | 'gated',
  needsReshare: false,
}));

vi.mock('@/hooks/useGroupHousehold', () => ({
  useGroupHousehold: () => ({
    status: household.status,
    contributions: household.contributions,
    optIn: vi.fn(() => Promise.resolve()),
    optOut: vi.fn(),
    busy: false,
    ready: true,
    needsReshare: household.needsReshare,
    myVotes: {},
    soon: null,
    setVote: vi.fn(),
  }),
}));
vi.mock('@/hooks/useMountTime', () => ({ useMountTime: () => NOW }));

import HouseholdPanel from './HouseholdPanel';

describe('HouseholdPanel — kronbelopp grupperas i tusental (BIN-1375)', () => {
  it('skriver hushållets summa och beloppet per tjänst med tusentalsavgränsare', () => {
    household.contributions = [
      {
        uid: 'a',
        providerIds: [8, 384],
        providerCosts: { 8: 1234, 384: 1500 },
        providerCampaigns: {},
        activeProviderIds: [8, 384],
        updatedAt: NOW,
      },
    ];

    render(<HouseholdPanel groupId="g1" />);

    expect(screen.getByText(krText('2 734 kr'), verbatim)).toBeInTheDocument();
    expect(screen.getByText(krText('· betalas av 1 · 1 234 kr'), verbatim)).toBeInTheDocument();
    expect(screen.getByText(krText('· betalas av 1 · 1 500 kr'), verbatim)).toBeInTheDocument();
  });
});

// ADR 0010:s disclosure-mening är bindande och får inte ändras; ADR 0026 lägger till
// raderna om "nytt inom 30 dagar" och röster med namn.
const BINDING_DISCLOSURE = 'I appen visas bara totalsiffror — men tekniskt kan delande gruppmedlemmar nå din enskilda lista.';

function normalisedText(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ');
}

describe('HouseholdPanel — samtyckesvyn (ADR 0010, ADR 0026)', () => {
  it('en ny delare ser den bindande meningen oförändrad, och raderna om nytt inom 30 dagar och röster med namn', () => {
    household.status = 'gated';
    household.needsReshare = false;
    household.contributions = [];
    const { container } = render(<HouseholdPanel groupId="g1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dela mina kostnader…' }));
    const text = normalisedText(container);
    expect(text).toContain(BINDING_DISCLOSURE);
    expect(text).toContain('Nytt inom 30 dagar: på vilka tjänster du har något nytt på väg inom 30 dagar.');
    expect(text).toContain('visas din röst med ditt namn');
    expect(screen.getByRole('button', { name: 'Dela' })).toBeInTheDocument();
  });

  it('en delare från före soon-fältet uppmanas dela igen, och får samma samtyckesvy', () => {
    household.status = 'active';
    household.needsReshare = true;
    household.contributions = [
      { uid: 'a', providerIds: [8], providerCosts: { 8: 169 }, providerCampaigns: {}, activeProviderIds: [], updatedAt: NOW },
    ];
    const { container } = render(<HouseholdPanel groupId="g1" />);
    expect(normalisedText(container)).toContain('Du har inte delat det ännu.');
    fireEvent.click(screen.getByRole('button', { name: 'Läs och dela igen…' }));
    const text = normalisedText(container);
    expect(text).toContain(BINDING_DISCLOSURE);
    expect(text).toContain('Nytt inom 30 dagar:');
    expect(screen.getByRole('button', { name: 'Dela' })).toBeInTheDocument();
  });

  it('en delare som redan delat om ser ingen uppmaning', () => {
    household.status = 'active';
    household.needsReshare = false;
    household.contributions = [
      { uid: 'a', providerIds: [8], providerCosts: { 8: 169 }, providerCampaigns: {}, activeProviderIds: [], soonProviderIds: [], updatedAt: NOW },
    ];
    render(<HouseholdPanel groupId="g1" />);
    expect(screen.queryByRole('button', { name: 'Läs och dela igen…' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sluta dela' })).toBeInTheDocument();
  });
});
