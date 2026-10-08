import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import PriceTable from './PriceTable';
import { PRICE_STALE_DAYS } from '@/lib/priceFreshness';
import type { PriceRow } from '@/lib/priceTableRows';

// #28:s villkor 10, rendered: the date is judged against the CLIENT clock after
// mount; a missing or malformed date shows "–", an old one gets "kan vara inaktuell".

const row = (key: string, kr: number, verifiedDate?: string, extra: Partial<PriceRow> = {}): PriceRow => ({
  key, providerId: Number(key), providerName: `Tjänst ${key}`, tierName: 'Nivå', kr, sport: false, verifiedDate, ...extra,
});

afterEach(() => {
  vi.useRealTimers();
});

function cellFor(key: string) {
  const r = screen.getByText(`Tjänst ${key}`).closest('tr')!;
  return within(r).getAllByRole('cell')[3];
}

describe('PriceTable — Kontrollerat', () => {
  it('shows "–" for missing and malformed dates, the date for a fresh one, and flags an old one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 5, 12));
    const old = new Date(2026, 9, 5 - PRICE_STALE_DAYS - 1);
    const oldIso = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}-${String(old.getDate()).padStart(2, '0')}`;
    await act(async () => {
      render(
        <PriceTable
          rows={[
            row('1', 100, undefined),
            row('2', 100, '2026-02-30'),
            row('3', 100, '2026-10-01'),
            row('4', 100, oldIso),
            row('5', 100, '2026-12-01'),
          ]}
        />,
      );
    });
    expect(cellFor('1')).toHaveTextContent(/^–$/);
    expect(cellFor('2')).toHaveTextContent(/^–$/);
    expect(cellFor('3')).toHaveTextContent(/^1 okt 2026$/);
    expect(cellFor('4')).toHaveTextContent('kan vara inaktuell');
    expect(cellFor('5')).toHaveTextContent(/^–$/); // future = unverified
  });

  it('never says "idag"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 5, 12));
    await act(async () => { render(<PriceTable rows={[row('1', 100, '2026-10-05')]} />); });
    expect(cellFor('1')).toHaveTextContent(/^5 okt 2026$/);
  });
});

describe('PriceTable — sorting and sport', () => {
  it('toggles between catalog order and cheapest first', async () => {
    await act(async () => {
      render(<PriceTable rows={[row('1', 300), row('2', 100), row('3', 200, undefined, { sport: true })]} />);
    });
    const names = () => screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent);
    expect(names()).toEqual(['Tjänst 1', 'Tjänst 2', 'Tjänst 3']);
    expect(screen.getByRole('button', { name: 'Per tjänst' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Billigast först' }));
    expect(names()).toEqual(['Tjänst 2', 'Tjänst 3', 'Tjänst 1']);
    expect(within(screen.getByText('Tjänst 3').closest('tr')!).getByText('sport')).toBeInTheDocument();
  });
});
