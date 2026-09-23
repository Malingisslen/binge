import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// BIN-1154. Namnet gick inte att ändra någonstans i appen — det sattes en gång och
// stod sedan kvar. Fältet som stänger det sparar på blur, och därför är frågan
// "vad ser användaren när det INTE sparades" lika viktig som att sparningen
// fungerar: en blur-sparning som tyst misslyckas ser ut att ha lyckats, och
// toasten lever bara ett par sekunder. Fältet är den bestående signalen.

const auth = vi.hoisted(() => ({
  user: { displayName: 'Malin', email: 'malin@example.com' } as Record<string, unknown> | null,
  signOut: vi.fn(async () => {}),
  updateDisplayName: vi.fn(async (name: string) => name),
}));
const toastShow = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toastShow }) }));

import { ProfileSection } from './ProfileSection';

const field = () => screen.getByLabelText('Namn') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { displayName: 'Malin', email: 'malin@example.com' };
  auth.updateDisplayName.mockImplementation(async (name: string) => name);
});

describe('ProfileSection — visningsnamnet går att ändra (BIN-1154)', () => {
  it('sparar det nya namnet när fältet lämnas, och bekräftar', async () => {
    await act(async () => { render(<ProfileSection />); });

    fireEvent.change(field(), { target: { value: 'Malin Gisslen' } });
    await act(async () => { fireEvent.blur(field()); });

    expect(auth.updateDisplayName).toHaveBeenCalledWith('Malin Gisslen');
    expect(toastShow).toHaveBeenCalledWith('Namnet sparat');
  });

  it('skriver inte alls när namnet är oförändrat', async () => {
    // Blur fyrar varje gång fokus lämnar fältet, även när användaren bara tittade
    // på det. Utan den här grinden blir varje fokusförlust en skrivning.
    await act(async () => { render(<ProfileSection />); });

    await act(async () => { fireEvent.blur(field()); });

    expect(auth.updateDisplayName).not.toHaveBeenCalled();
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('ett tomt namn sparas aldrig, och fältet återställs synligt', async () => {
    await act(async () => { render(<ProfileSection />); });

    fireEvent.change(field(), { target: { value: '   ' } });
    await act(async () => { fireEvent.blur(field()); });

    expect(auth.updateDisplayName).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith('Namnet kan inte vara tomt.');
    // Den bestående signalen: fältet står inte kvar tomt efter att toasten dött.
    expect(field().value).toBe('Malin');
  });

  it('en vägrad skrivning bekräftas ALDRIG, och fältet återställs', async () => {
    // Det här är kriteriet som skiljer fixen från en som ser ut att fungera:
    // skrivvägen kan neka, och en ovillkorlig bekräftelse gör varje nekande till
    // en lögn. Bekräftelsen är gatad på att await:en inte kastade.
    auth.updateDisplayName.mockRejectedValueOnce(new Error('permission-denied'));
    await act(async () => { render(<ProfileSection />); });

    fireEvent.change(field(), { target: { value: 'Nytt namn' } });
    await act(async () => { fireEvent.blur(field()); });

    expect(toastShow).not.toHaveBeenCalledWith('Namnet sparat');
    expect(toastShow).toHaveBeenCalledWith('Kunde inte spara. Försök igen om en stund.');
    expect(field().value).toBe('Malin');
  });

  // BIN-1275: sparningen kan lagra något kortare än det som står i fältet (taket
  // mäts i UTF-16-enheter, och ett emoji-par som straddlar det kapas helt). Fältet
  // ska visa det som LAGRADES, annars står "Namnet sparat" över ett annat namn.
  it('fältet visar det lagrade namnet efter sparningen', async () => {
    auth.updateDisplayName.mockImplementationOnce(async () => 'Kapat');
    await act(async () => { render(<ProfileSection />); });

    fireEvent.change(field(), { target: { value: 'Kapat och lite till' } });
    await act(async () => { fireEvent.blur(field()); });

    expect(field().value).toBe('Kapat');
    expect(toastShow).toHaveBeenCalledWith('Namnet sparat');
  });

  it('skriver inte över det användaren hunnit skriva under sparningen', async () => {
    let release!: (v: string) => void;
    auth.updateDisplayName.mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));
    await act(async () => { render(<ProfileSection />); });

    fireEvent.change(field(), { target: { value: 'Första' } });
    await act(async () => { fireEvent.blur(field()); });
    fireEvent.change(field(), { target: { value: 'Andra' } });
    await act(async () => { release('Första'); });

    expect(field().value).toBe('Andra');
  });

  it('fältet bär taket och är kopplat till sin hjälptext', async () => {
    // `maxLength` kapar även en inklistrad sträng — mätt i BIN-1134 — så det här
    // är den yta där avkortningen faktiskt syns för den som skriver.
    await act(async () => { render(<ProfileSection />); });

    expect(field().maxLength).toBe(80);
    expect(field().getAttribute('aria-describedby')).toBe('displayName-help');
    expect(field().getAttribute('autocomplete')).toBe('nickname');
  });
});
