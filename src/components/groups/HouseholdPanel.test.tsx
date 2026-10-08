import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HouseholdContribution } from '@/lib/advisor/householdAggregate';
import { krText, verbatim } from '@/test/krText';

// BIN-1375: formatKr's own test proves the helper groups thousands, but not that
// this panel calls it. A regression to a raw `{overview.totalKr}` would print
// "2734" and stay green everywhere else.

const NOW = Date.UTC(2026, 8, 30, 12);

const household = vi.hoisted(() => ({
  contributions: [] as HouseholdContribution[],
}));

vi.mock('@/hooks/useGroupHousehold', () => ({
  useGroupHousehold: () => ({
    status: 'active',
    contributions: household.contributions,
    optIn: vi.fn(),
    optOut: vi.fn(),
    busy: false,
    ready: true,
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
