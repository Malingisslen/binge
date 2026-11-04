import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CancelHint, { MANAGE_URL_STALE_DAYS } from './CancelHint';
import { getProvider } from '@/lib/tmdb/providers';
import { nextAvoidableCharge } from '@/lib/renewal';
import { formatPriceDay } from '@/lib/priceFreshness';
import { toIsoDate } from '@/lib/utils';

// Netflix (8) har en kontrollerad länk; Viaplay (76) har ingen. Datumet läses ur katalogen
// så att testet inte faller varje gång prisrutinen kontrollerar länken på nytt.
const [VY, VM, VD] = getProvider(8)!.manageUrlVerifiedDate!.split('-').map(Number);
const VERIFIED = new Date(VY, VM - 1, VD);
const NEXT_CHARGE = formatPriceDay(toIsoDate(nextAvoidableCharge(11, VERIFIED)));

describe('CancelHint', () => {
  it('länkar till tjänstens sida och säger vilken dragning uppsägningen hinner före', () => {
    render(<CancelHint providerId={8} billingDay={11} now={VERIFIED} />);
    const link = screen.getByRole('link', { name: `Säg upp före dragningen ${NEXT_CHARGE} ›` });
    expect(link.getAttribute('href')).toBe('https://www.netflix.com/cancelplan');
  });

  it('hänvisar till kontoinställningarna, utan länk, för en tjänst utan kontrollerad länk', () => {
    render(<CancelHint providerId={76} billingDay={11} now={VERIFIED} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(`Säg upp i tjänstens kontoinställningar före dragningen ${NEXT_CHARGE}`)).toBeTruthy();
  });

  it('hänvisar till kontoinställningarna även utan faktureringsdag', () => {
    render(<CancelHint providerId={76} billingDay={undefined} now={VERIFIED} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Säg upp i tjänstens kontoinställningar')).toBeTruthy();
  });

  it('döljer en länk som ingen kontrollerat inom fönstret', () => {
    const late = new Date(VY, VM - 1, VD + MANAGE_URL_STALE_DAYS + 1);
    const { container } = render(<CancelHint providerId={8} billingDay={undefined} now={late} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('Säg upp i tjänstens kontoinställningar');
    const edge = new Date(VY, VM - 1, VD + MANAGE_URL_STALE_DAYS);
    render(<CancelHint providerId={8} billingDay={undefined} now={edge} />);
    expect(screen.getByRole('link', { name: 'Säg upp ›' })).toBeTruthy();
  });

  it('visar ingenting för en gratistjänst', () => {
    const { container } = render(<CancelHint providerId={520} billingDay={undefined} now={VERIFIED} />);
    expect(container.innerHTML).toBe('');
  });
});
