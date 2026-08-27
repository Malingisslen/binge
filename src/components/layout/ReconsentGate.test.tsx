import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ReconsentGate } from './ReconsentGate';

// BIN-909. The screen exists because `ensureUserProfile` used to re-create `users/{uid}`
// for a RETURNING account and stamp `termsAcceptedAt`/`ageConfirmedAt` with the server's
// now — a consent record the app invented for someone who had just asked to leave. The
// document is now created ONLY by `completeReconsent`, and only from this screen.
//
// So the property under test is not "the button works". It is that nothing reaches
// `completeReconsent` until the user has actually answered both questions: #5 Legal's
// condition 2 (age and terms are distinct facts, one blanket box is not specific consent
// to either) and #6 DPO's condition 1 (a screen wrapped around a decision already taken
// would be worse than today's silent stamp, because it would LOOK deliberate).

const auth = vi.hoisted(() => ({
  completeReconsent: vi.fn<() => Promise<void>>(async () => {}),
  signOut: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth.completeReconsent.mockReset();
  auth.completeReconsent.mockResolvedValue(undefined);
  auth.signOut.mockReset();
  auth.signOut.mockResolvedValue(undefined);
});

function boxes() {
  return screen.getAllByRole('checkbox') as HTMLInputElement[];
}
function submitButton() {
  return screen.getByRole('button', { name: 'Skapa profil' }) as HTMLButtonElement;
}

describe('ReconsentGate', () => {
  it('säger att profilen skapas på nytt och att inget återställs', () => {
    render(<ReconsentGate />);

    const body = document.body.textContent ?? '';
    expect(screen.getByText('Välkommen tillbaka')).toBeTruthy();
    // #19 Customer Support, villkor 2: någon som landar här letar efter sitt bibliotek.
    // Skärmen måste säga rakt ut att knappen ger ett tomt konto.
    expect(body).toContain('tomt konto');
    expect(body).toContain('återställer inte');
  });

  it('kryssar inte i någon ruta åt användaren', () => {
    // En förkryssad ruta är inget samtycke. Den här assertionen är billig och är
    // hela skillnaden mellan skärmen och den tysta stämpeln den ersätter.
    render(<ReconsentGate />);

    expect(boxes()).toHaveLength(2);
    expect(boxes().every(b => b.checked)).toBe(false);
  });

  it('skriver INGENTING med noll rutor ikryssade', () => {
    render(<ReconsentGate />);

    fireEvent.click(submitButton());

    expect(auth.completeReconsent).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(true);
  });

  it('skriver INGENTING med bara ålderrutan ikryssad', () => {
    render(<ReconsentGate />);

    fireEvent.click(boxes()[0]);
    fireEvent.click(submitButton());

    expect(auth.completeReconsent).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(true);
  });

  it('skriver INGENTING med bara villkorsrutan ikryssad', () => {
    // Båda enskilda fallen prövas: en `||` i stället för `&&` släpper igenom det ena
    // men inte det andra, och ett test som bara kör den första rutan är blint för det.
    render(<ReconsentGate />);

    fireEvent.click(boxes()[1]);
    fireEvent.click(submitButton());

    expect(auth.completeReconsent).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(true);
  });

  it('skapar profilen EN gång när båda rutorna är ikryssade', async () => {
    // Kontrollen. Utan den passerar allt ovan på en skärm vars knapp aldrig gör något.
    render(<ReconsentGate />);

    fireEvent.click(boxes()[0]);
    fireEvent.click(boxes()[1]);
    expect(submitButton().disabled).toBe(false);

    await act(async () => { fireEvent.click(submitButton()); });

    expect(auth.completeReconsent).toHaveBeenCalledTimes(1);
  });

  it('en avkryssad ruta spärrar knappen igen', () => {
    // Samtycket är levande fram till submit — ångrar användaren sig innan hon klickar
    // ska skärmen följa med tillbaka, inte minnas att villkoret en gång var uppfyllt.
    render(<ReconsentGate />);

    fireEvent.click(boxes()[0]);
    fireEvent.click(boxes()[1]);
    expect(submitButton().disabled).toBe(false);

    fireEvent.click(boxes()[1]);

    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    expect(auth.completeReconsent).not.toHaveBeenCalled();
  });

  it('den spärrade knappen förklarar sig för en skärmläsare', () => {
    // #2 Accessibility, villkor 3: en död knapp utan förklaring är en återvändsgränd
    // för den som inte ser vilken ruta som saknas.
    render(<ReconsentGate />);

    const hintId = submitButton().getAttribute('aria-describedby');
    expect(hintId).toBe('reconsent-hint');
    expect(document.getElementById(hintId!)?.textContent).toContain('båda rutorna');
  });

  it('BIN-1032: ett VÄGRAT skrivförsök får ett annat besked än ett nätverksfel', async () => {
    // #19 Kundsupports blockerande villkor. Det generiska felet ber användaren kontrollera
    // anslutningen och försöka igen. För ett vägrat skrivförsök är det fel råd: markören
    // försvinner inte av sig själv, så varje omförsök faller likadant — och det här är en
    // skärm vars besökare redan är förvirrad. `DELETION_IN_PROGRESS` finns som egen kod
    // just för att en anropare ska kunna skilja de två åt.
    auth.completeReconsent.mockRejectedValueOnce(
      new Error('binge/deletion-in-progress: kontot håller på att raderas'),
    );
    render(<ReconsentGate />);

    fireEvent.click(boxes()[0]);
    fireEvent.click(boxes()[1]);
    await act(async () => { fireEvent.click(submitButton()); });

    const alert = screen.getByRole('alert').textContent!;
    expect(alert).toContain('raderas');
    // Det avgörande: inget råd om anslutningen, och ingen uppmaning att försöka igen.
    expect(alert).not.toContain('anslutningen');
    expect(alert).not.toContain('försök igen');
    // Vägen framåt är support, eftersom omförsök inte är en väg framåt här.
    expect(alert).toContain('hej@binge.nu');
    expect(submitButton().disabled).toBe(false);
  });

  it('ett fel vid skapandet säger vad som hände och låter användaren försöka igen', async () => {
    auth.completeReconsent.mockRejectedValueOnce(new Error('offline'));
    render(<ReconsentGate />);

    fireEvent.click(boxes()[0]);
    fireEvent.click(boxes()[1]);
    await act(async () => { fireEvent.click(submitButton()); });

    expect(screen.getByRole('alert').textContent).toContain('kunde inte skapas');
    // Knappen får inte bli kvar i "Skapar…" — då är skärmen låst efter ett nätverksfall.
    expect(submitButton().disabled).toBe(false);
  });

  it('utloggning är alltid nåbar', () => {
    // Samma skäl som på DeletionLimbo: skärmen ersätter hela appen, så en delad enhet
    // vore fångad av en skärm med bara en knapp.
    render(<ReconsentGate />);

    fireEvent.click(screen.getByRole('button', { name: 'Logga ut' }));

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.completeReconsent).not.toHaveBeenCalled();
  });
});
