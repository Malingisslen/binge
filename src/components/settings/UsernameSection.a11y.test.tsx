/**
 * BIN-1161: falten i "Publik profil" hade etiketter som bara lag VISUELLT intill
 * kontrollen. En skarmlasare som listar formularets falt fick dem utan namn.
 *
 * Testerna fragar efter falten PA SITT NAMN (`getByLabelText`), vilket ar exakt
 * den vagen en skarmlasare tar — ett test som i stallet letade upp `<input>` via
 * en CSS-valjare hade varit gront bade fore och efter fixen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  user: {} as Record<string, unknown> | null,
  updateUsername: vi.fn(async () => {}),
  updateBio: vi.fn(async () => {}),
  updateDefaultVisibility: vi.fn(async () => {}),
  visibilitySyncPending: false,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));

import { UsernameSection } from './UsernameSection';

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { username: 'malin', bio: 'hej', defaultVisibility: 'private' };
  auth.visibilitySyncPending = false;
});

async function renderSection() {
  await act(async () => { render(<UsernameSection />); });
}

describe('UsernameSection — falten har tillgangliga namn (BIN-1161)', () => {
  it('anvandarnamnsfaltet gar att hitta pa sin etikett', async () => {
    await renderSection();
    expect((screen.getByLabelText('Användarnamn') as HTMLInputElement).value).toBe('malin');
  });

  it('bio-faltet gar att hitta pa sin etikett', async () => {
    await renderSection();
    expect((screen.getByLabelText('Bio') as HTMLTextAreaElement).value).toBe('hej');
  });

  it('anvandarnamnet pekar pa sin hjalptext nar det finns en', async () => {
    await renderSection();
    const described = screen.getByLabelText('Användarnamn').getAttribute('aria-describedby');
    expect(described).toBe('username-help');
    expect(document.getElementById(described!)?.textContent).toContain('binge.nu/user/malin');
  });

  it('pekar INTE pa en hjalptext som inte renderas — utan anvandarnamn finns ingen', async () => {
    auth.user = { username: null, bio: '', defaultVisibility: 'private' };
    await renderSection();
    expect(screen.getByLabelText('Användarnamn').getAttribute('aria-describedby')).toBeNull();
    expect(document.getElementById('username-help')).toBeNull();
  });

  it('synlighetsvalen annonseras som en NAMNGIVEN grupp, inte tre losa radioknappar', async () => {
    await renderSection();
    const group = screen.getByRole('radiogroup', { name: 'Standardsynlighet' });
    expect(group.querySelectorAll('input[type="radio"]').length).toBe(3);
  });

  it('anvandarnamnsfaltet bar ratt autofyll-syfte', async () => {
    await renderSection();
    expect(screen.getByLabelText('Användarnamn').getAttribute('autocomplete')).toBe('username');
  });
});
