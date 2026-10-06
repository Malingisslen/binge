import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CancelHint, { MANAGE_URL_STALE_DAYS } from './CancelHint';

// Netflix (8) har en kontrollerad länk satt 2026-10-06; Viaplay (76) har ingen.
const VERIFIED = new Date(2026, 9, 6);

describe('CancelHint', () => {
  it('länkar till tjänstens sida och säger vilken dragning uppsägningen hinner före', () => {
    render(<CancelHint providerId={8} billingDay={11} now={VERIFIED} />);
    const link = screen.getByRole('link', { name: 'Säg upp före dragningen 11 okt 2026 ›' });
    expect(link.getAttribute('href')).toBe('https://www.netflix.com/cancelplan');
  });

  it('visar bara datumet, utan länk, för en tjänst utan kontrollerad länk', () => {
    render(<CancelHint providerId={76} billingDay={11} now={VERIFIED} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Säg upp före dragningen 11 okt 2026')).toBeTruthy();
  });

  it('renderar ingenting utan länk och utan faktureringsdag', () => {
    const { container } = render(<CancelHint providerId={76} billingDay={undefined} now={VERIFIED} />);
    expect(container.innerHTML).toBe('');
  });

  it('döljer en länk som ingen kontrollerat inom fönstret', () => {
    const late = new Date(2026, 9, 6 + MANAGE_URL_STALE_DAYS + 1);
    const { container } = render(<CancelHint providerId={8} billingDay={undefined} now={late} />);
    expect(container.innerHTML).toBe('');
    const edge = new Date(2026, 9, 6 + MANAGE_URL_STALE_DAYS);
    render(<CancelHint providerId={8} billingDay={undefined} now={edge} />);
    expect(screen.getByRole('link', { name: 'Säg upp ›' })).toBeTruthy();
  });
});
