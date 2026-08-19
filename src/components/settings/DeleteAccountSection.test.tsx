// src/components/settings/DeleteAccountSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { DeleteAccountSection } from './DeleteAccountSection';
import { DeletionLimbo } from '@/components/layout/DeletionLimbo';
import { CASCADE_PARTIAL, DELETION_HANDED_OFF, REQUIRES_RECENT_LOGIN, STALE_SESSION_PREFLIGHT } from '@/lib/authErrors';

// BIN-777, and the Customer Support critique that gated it (2026-08-06).
// Wording of the recent-login branch revised by BIN-796 (Malin's call, 2026-08-07).
// Fourth branch and the retry-everywhere rule added by BIN-876 (ADR 0020, c6).
//
// Hand-off rule and the two renamed buttons: BIN-816 (integration review,
// 2026-08-13) — a failure after the deletion marker goes down unmounts this
// component, so the branches that can only happen then must not offer a button
// they no longer own, and must name the limbo screen's button instead.
//
// Deleting an account has four failure messages, and the whole point of the file
// is that they make DIFFERENT claims about the person's data:
//   preflight        — nothing was touched, and says so.
//   recent-login     — the cascade ran; the account survives. Says started, not
//                      finished, and never that anything was deleted.
//   partial cascade  — some chunks committed and then it fell over, OR the
//                      cascade finished and only `deleteUser` failed. Says data
//                      may already be gone.
//   generic          — reached only from paths that run BEFORE the first write
//                      (the token read, the snapshot reads, the plan build, and
//                      a first-chunk failure, which `applyDeletionPlan` leaves
//                      untagged precisely because nothing committed).
//
// The full-string assertions are kept, not loosened, from the BIN-796 revision.
// The risk they guard is unchanged: a mutant that swaps two branches keeps any
// shared prefix and survives a substring check, and the failure mode is a
// message making a claim about someone's data that the code cannot back up.
// BIN-876 widened the surface — the generic branch now carries the promise
// clause too — so the branch-swap risk went UP, not down, and each message is
// pinned whole with its distinguishing clause asserted separately.

const auth = vi.hoisted(() => ({
  deleteAccount: vi.fn<() => Promise<void>>(async () => {}),
  // BIN-936 renders `DeletionLimbo` in this file to read its button's REAL label
  // instead of spelling it a third time. That screen also offers a sign-out, so
  // the shared mock has to carry it. No assertion in this file reads it.
  signOut: vi.fn<() => Promise<void>>(async () => {}),
}));
const toast = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }));

// The REAL shape AuthContext throws for our own preflight: it carries BOTH codes
// on purpose — `auth/requires-recent-login` is what every existing reader and
// Firebase itself recognise, and the preflight code is the only thing separating
// "nothing was touched" from the same error thrown after the cascade. A fixture
// carrying only the preflight code would be reachable from EITHER branch order,
// so the swap mutant this file exists to kill survives it. (Caught by the
// integration review, 2026-08-06 — the first fixture did exactly that and passed
// 5/5 against a swapped component.)
const PREFLIGHT_ERROR = `${REQUIRES_RECENT_LOGIN} (${STALE_SESSION_PREFLIGHT}): sessionen är för gammal för att radera kontot`;
// Likewise real. Two tags, and both matter: `applyDeletionPlan` prefixes
// `CASCADE_PARTIAL`, and `deleteAccount` then wraps everything thrown after the
// marker went down in `DELETION_HANDED_OFF` — which is what tells this component
// that `AppShell` has already swapped it out for the limbo screen.
const PARTIAL_ERROR = `${DELETION_HANDED_OFF}: ${CASCADE_PARTIAL}: FirebaseError: Failed to get document because the client is offline.`;
const RECENT_LOGIN_ERROR = `${DELETION_HANDED_OFF}: Firebase: Error (${REQUIRES_RECENT_LOGIN}).`;
// The same classification, UNTAGGED — and the only one of the four that can be.
// BIN-813 gave the freshness gate a second message for a session that is already
// marked (a retry of an aborted deletion), and `AuthContext` throws it BEFORE the
// try/catch that stamps `DELETION_HANDED_OFF`. So it classifies as `recent-login`
// while the component is genuinely still mounted — the one combination the file
// had no fixture for (BIN-908 finding 1, integration review 2026-08-15).
const STALE_MARKED_ERROR = `${REQUIRES_RECENT_LOGIN}: sessionen är för gammal för att slutföra raderingen`;

const PROMISE_CLAUSE = 'Ingenting har raderats.';
const PREFLIGHT_MSG = 'Du måste logga in igen innan du kan ta bort ditt konto. Ingenting har raderats.';
const RECENT_LOGIN_MSG =
  'Raderingen har påbörjats men inte slutförts. Logga in igen och tryck på Slutför raderingen för att avsluta den.';
const PARTIAL_MSG =
  'Raderingen avbröts av ett anslutningsfel innan den hann bli klar. En del av din data kan redan vara borttagen. Tryck på Slutför raderingen — resten går igenom utan att skada det som redan tagits bort.';
const GENERIC_MSG = 'Kunde inte ta bort kontot. Ingenting har raderats. Kontrollera anslutningen och försök igen.';

const RETRY_ACTION = { label: 'Försök igen', onClick: expect.any(Function) };

async function attemptDelete() {
  render(<DeleteAccountSection />);
  fireEvent.click(screen.getByText('Ta bort mitt konto'));
  await act(async () => {
    fireEvent.click(screen.getByText('Ja, ta bort permanent'));
  });
}

beforeEach(() => {
  auth.deleteAccount.mockReset();
  auth.deleteAccount.mockResolvedValue(undefined);
  toast.show.mockClear();
});

describe('DeleteAccountSection — vad användaren får veta när raderingen failar', () => {
  it('vår egen förkontroll: lovar att INGENTING raderats, ordagrant', async () => {
    auth.deleteAccount.mockRejectedValue(new Error(PREFLIGHT_ERROR));

    await attemptDelete();

    expect(toast.show).toHaveBeenCalledWith(PREFLIGHT_MSG, RETRY_ACTION);
    // Löftesklausulen är hela skillnaden mot grannmeddelandet — pinna den
    // separat, så att en mutant som byter plats på grenarna inte kan överleva
    // på den gemensamma inledningen.
    expect(toast.show.mock.calls[0][0]).toContain(PROMISE_CLAUSE);
    // Och den här grenen är den ENDA som får be om en ny inloggning innan
    // kaskaden ens kört — den delar den frasen bara med recent-login-grenen,
    // som i sin tur aldrig bär löftesklausulen (nästa test).
    expect(toast.show.mock.calls[0][0]).toContain('logga in igen');
  });

  it('Firebases requires-recent-login: säger INTE att ingenting raderats — kaskaden kan redan ha kört', async () => {
    auth.deleteAccount.mockRejectedValue(new Error(RECENT_LOGIN_ERROR));

    await attemptDelete();

    // No action here, and that is the fix rather than a regression: this failure
    // happens after the marker is down, so `AppShell` has already replaced this
    // component with the limbo screen. A retry button would call `setConfirming`
    // on something unmounted — a promise the UI cannot keep (integration review,
    // 2026-08-13). The limbo screen's own "Slutför raderingen" is the button,
    // and the text below names it.
    expect(toast.show).toHaveBeenCalledWith(RECENT_LOGIN_MSG);
    expect(toast.show.mock.calls[0][1]).toBeUndefined();
    expect(toast.show.mock.calls[0][0]).toContain('Slutför raderingen');
    expect(toast.show.mock.calls[0][0]).not.toContain(PROMISE_CLAUSE);
    // BIN-796: silence read as "nothing happened". The message must say deletion
    // started, and must not claim it finished either — both halves, or the honest
    // middle ground collapses back to one of the two lies.
    expect(toast.show.mock.calls[0][0]).toContain('påbörjats');
    expect(toast.show.mock.calls[0][0]).not.toContain('raderat');
    // There is no auto-resume — logging in only refreshes the token the preflight
    // reads. A message that stops at "logga in igen" strands the user on an empty
    // but still-existing account, so naming the action that finishes the job is
    // part of the promise (#19 Customer Support critique, 2026-08-07). The name
    // changed on 2026-08-13: the button is now the limbo screen's "Slutför
    // raderingen", pinned above, because this component is no longer on screen.
    expect(toast.show.mock.calls[0][0]).not.toContain('Ta bort mitt konto');
  });

  it('förkontrollen på ett ANDRA försök: samma recent-login-text, men knappen finns kvar', async () => {
    // BIN-908 finding 1. Den här formen fanns inte förut: en klassificering
    // `recent-login` UTAN hand-over-taggen. Den uppstår när någon återkommer till
    // inställningssidan efter en avbruten radering — markören står, förkontrollen
    // kastar BIN-813:s "slutföra"-variant, och den kastas FÖRE try-blocket i
    // AuthContext, så den taggas aldrig.
    //
    // Två saker måste hålla samtidigt, och de kommer från olika håll:
    //   - texten från klassificeringen (`recent-login`), som varken lovar att
    //     ingenting raderats eller att allt är klart, och
    //   - knappen från taggen (som saknas), för här ÄR komponenten monterad —
    //     AppShell har inte bytts ut, eftersom kaskaden aldrig startade om.
    // Testet ovanför pinnar den taggade varianten UTAN knapp; det är kombinationen
    // av samma text MED knapp som ingenting sa något om.
    auth.deleteAccount.mockRejectedValue(new Error(STALE_MARKED_ERROR));

    await attemptDelete();

    expect(toast.show).toHaveBeenCalledWith(RECENT_LOGIN_MSG, RETRY_ACTION);
    // Och den får inte glida över i förkontrollens lugnande löfte bara för att
    // felet kommer från samma gate: markören står, så kaskaden HAR kört en gång.
    expect(toast.show.mock.calls[0][0]).not.toContain(PROMISE_CLAUSE);
  });

  it('avbrott mitt i kaskaden: säger att data KAN vara borta — aldrig att ingenting hände', async () => {
    auth.deleteAccount.mockRejectedValue(new Error(PARTIAL_ERROR));

    await attemptDelete();

    expect(toast.show).toHaveBeenCalledWith(PARTIAL_MSG);
    // Kärnan i BIN-876: det här felet bär samma nätverksord som det generiska
    // ("anslutningsfel"), så det är LÖFTESKLAUSULENS FRÅNVARO som skiljer dem.
    // En mutant som tappar CASCADE_PARTIAL-grenen landar i den generiska och
    // börjar lova att ingenting raderats — vilket är precis lögnen biljetten
    // filades om.
    expect(toast.show.mock.calls[0][0]).not.toContain(PROMISE_CLAUSE);
    expect(toast.show.mock.calls[0][0]).toContain('kan redan vara borttagen');
    // Och den får inte be om en ny inloggning: det är inte det som är fel här,
    // och grenen ovanför är den som äger den instruktionen.
    expect(toast.show.mock.calls[0][0]).not.toContain('logga in igen');
    // Ingen knapp — limbo-skärmen har tagit över. Texten pekar på DESS knapp.
    expect(toast.show.mock.calls[0][1]).toBeUndefined();
    expect(toast.show.mock.calls[0][0]).toContain('Slutför raderingen');
  });

  it('okänt fel: den generiska texten, och den låtsas aldrig vara ett inloggningsfel', async () => {
    auth.deleteAccount.mockRejectedValue(new Error('auth/network-request-failed'));

    await attemptDelete();

    expect(toast.show).toHaveBeenCalledWith(GENERIC_MSG, RETRY_ACTION);
    // Skyddar mot att en framtida felkod tyst hamnar i den lugnande hinken:
    // den generiska grenen får aldrig be någon logga in igen.
    expect(toast.show.mock.calls[0][0]).not.toContain('logga in igen');
    // BIN-876: den här grenen FÅR lova att ingenting raderats, men bara för att
    // varje väg hit ligger före första skrivningen — förkontrollen, läsningarna,
    // planbygget, och ett fel på FÖRSTA klumpen (som applyDeletionPlan lämnar
    // otaggat just därför). Går den lovande meningen förlorad har någon flyttat
    // en gren som faktiskt kan ha skrivit hit.
    expect(toast.show.mock.calls[0][0]).toContain(PROMISE_CLAUSE);
  });

  it('ett fel som inte är ett Error-objekt hamnar också i den generiska grenen', async () => {
    auth.deleteAccount.mockRejectedValue('bara en sträng');

    await attemptDelete();

    expect(toast.show).toHaveBeenCalledWith(GENERIC_MSG, RETRY_ACTION);
  });

  it('knappen följer med precis när komponenten finns kvar att trycka i', async () => {
    // #19 Customer Support, 2026-08-13: den generiska grenen hade ingen åtgärd
    // alls, så den som tappade nätet fick 2,5 sekunder och ingenting att trycka
    // på. Integrationsgranskningen samma dag visade baksidan: efter att markören
    // lagts ned är komponenten avmonterad och knappen en no-op.
    //
    // Regeln är därför INTE "alla grenar får en knapp" utan "knappen finns exakt
    // när den fungerar" — dvs när felet saknar hand-over-taggen. Prövas i BÅDA
    // riktningarna över de fyra grenar som finns; listan är handskriven, så en
    // femte gren måste läggas till här också (inget tvingar det).
    const cases: [Error, boolean][] = [
      [new Error(PREFLIGHT_ERROR), true],
      [new Error('auth/network-request-failed'), true],
      // Samma klassificering som raden under, motsatt utfall — beviset för att
      // regeln verkligen läser TAGGEN och inte klassificeringen (BIN-908).
      [new Error(STALE_MARKED_ERROR), true],
      [new Error(RECENT_LOGIN_ERROR), false],
      [new Error(PARTIAL_ERROR), false],
      [new Error(`${DELETION_HANDED_OFF}: auth/network-request-failed`), false],
    ];
    for (const [err, expectAction] of cases) {
      cleanup();
      toast.show.mockClear();
      auth.deleteAccount.mockRejectedValue(err);
      await attemptDelete();
      if (expectAction) expect(toast.show.mock.calls[0][1], err.message).toEqual(RETRY_ACTION);
      else expect(toast.show.mock.calls[0][1], err.message).toBeUndefined();
    }
  });

  it('omförsöksknappen öppnar bekräftelsesteget igen', async () => {
    auth.deleteAccount.mockRejectedValue(new Error('auth/network-request-failed'));

    await attemptDelete();

    // Utan det här är etiketten "Försök igen" en tom gest: den ska faktiskt
    // föra tillbaka användaren till knappen som slutför raderingen.
    expect(screen.queryByText('Ja, ta bort permanent')).toBeNull();
    const action = toast.show.mock.calls[0][1] as { onClick: () => void };
    await act(async () => { action.onClick(); });
    expect(screen.getByText('Ja, ta bort permanent')).toBeTruthy();
  });

  it('kontaktvägen står kvar i BÅDA lägena — den är inte ett av bekräftelsestegets syskon', async () => {
    // BIN-905. Poängen är inte att adressen finns, utan att den finns OAVSETT
    // `confirming` — det är hela skälet till att den får ligga i sektionen i
    // stället för i de fyra låsta meddelandena.
    //
    // Måste därför driva båda lägena. Ett test som bara läser utgångsläget är
    // grönt även om stycket flyttas in i `{!confirming && …}`, och då försvinner
    // adressen i exakt det ögonblick användaren står i bekräftelsesteget och är
    // som mest osäker. Det var precis den luckan förra försöket lämnade öppen
    // (mutanten överlevde 10/10) och den här biljetten fälldes för.
    render(<DeleteAccountSection />);

    const inStartState = screen.getByRole('link', { name: 'hej@binge.nu' });
    expect(inStartState.getAttribute('href')).toBe('mailto:hej@binge.nu');

    fireEvent.click(screen.getByText('Ta bort mitt konto'));

    // Bekräftelsesteget är uppe — samma adress ska fortfarande stå där.
    expect(screen.getByText('Ja, ta bort permanent')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'hej@binge.nu' }).getAttribute('href'))
      .toBe('mailto:hej@binge.nu');
  });

  it('knappen går att använda igen efter ett fel — ett misslyckat försök får inte se ut som ett hängt försök', async () => {
    auth.deleteAccount.mockRejectedValue(new Error(PREFLIGHT_ERROR));

    await attemptDelete();

    // Tillbaka till utgångsläget: bekräftelsesteget stängt, ingen kvarhängande
    // "Raderar…"-knapp. Utan detta läser ett fel som att appen frusit mitt i.
    expect(screen.getByText('Ta bort mitt konto')).toBeTruthy();
    expect(screen.queryByText('Raderar…')).toBeNull();
    expect(screen.queryByText('Ja, ta bort permanent')).toBeNull();
  });
});

// ── BIN-936 / BIN-925: de två skärmarna hålls ihop av något ─────────────────────────
//
// #19 Customer Supports blinda kritik, 2026-08-18. Två skärmar beskriver samma
// klassificerade feltillstånd från var sin sida av en avmontering: den här sektionen
// berättar det från en skärm som är på väg att försvinna, `DeletionLimbo` från skärmen
// som tar över. Ingenting band ihop dem — och de fyra texterna är juridiskt godkända och
// får inte skrivas om (BIN-813 villkor 4), så det enda som KAN byggas är bindningen.
//
// Vad testet faktiskt gör, utan skryt: det renderar limbo-skärmen och läser knappens
// `textContent`, och jämför DEN strängen med de två meddelandena. Etiketten står visserligen
// skriven en gång till i `getByRole`-frågan nedan — det här är alltså ingen "sista kopian".
// Det som gör testet till en spärr och inte en omskrivning av dagens strängar är att det
// blir rött åt BÅDA hållen: döps knappen om hittar `getByRole` ingenting, och formuleras
// något av meddelandena om faller `toContain`. (En tidigare version av den här kommentaren
// räknade upp "tre ställen" och kallade sig "inte en fjärde kopia". Båda var fel —
// integrationsgranskningen 2026-08-19 räknade om.)
describe('BIN-936 — båda skärmarnas texter för samma feltillstånd namnger samma åtgärd', () => {
  it('hand-over-texterna namnger limbo-knappens FAKTISKA etikett, inte en kopia av den', () => {
    render(<DeletionLimbo />);

    // Frågan ställs till skärmen, inte till en konstant. Byter limbo-skärmen namn på
    // knappen kastar `getByRole` här; byter något av meddelandena formulering faller
    // `toContain` nedanför. Båda riktningarna fäller alltså testet, vilket är hela
    // skälet att det finns.
    const label = screen.getByRole('button', { name: 'Slutför raderingen' }).textContent!.trim();

    // De två grenar som saknar en egen knapp — hand-over har skett, den här komponenten
    // är avmonterad, och texten pekar med flit vidare till limbo-skärmen.
    expect(RECENT_LOGIN_MSG).toContain(label);
    expect(PARTIAL_MSG).toContain(label);
  });

  it('den otaggade andra-försöks-grenen namnger en knapp som INTE är dess synliga åtgärd', async () => {
    // Den kvarstående luckan, pinnad i stället för bortputsad. `STALE_MARKED_ERROR`
    // klassificeras som `recent-login` men saknar hand-over-taggen, så komponenten lever
    // och toasten får sin åtgärd — märkt "Försök igen". Meddelandet säger ändå "Slutför
    // raderingen", som är limbo-skärmens knapp.
    //
    // #19:s åtkomlighetsfynd (statiskt härlett vid `2d67ff7`, inte mekaniskt bevisat):
    // ingen verklig användarväg når det här läget, eftersom `AuthContext` sätter
    // `deletionInProgress` vid :536, :638 och :1227 medan färskhetsspärrens throw ligger
    // vid ~:1190 — före markören — och `AppShell` då redan bytt ut hela appen. Testet är
    // därför ett DEFENSIVT kontraktstest, inte en beskrivning av något användare möter.
    // Återöppna BIN-925 om någon av de tre anropsplatserna tas bort eller flyttas
    // relativt den throwen.
    auth.deleteAccount.mockRejectedValue(new Error(STALE_MARKED_ERROR));

    await attemptDelete();

    const action = toast.show.mock.calls[0][1] as { label: string };
    expect(action.label).toBe('Försök igen');
    expect(action.label).not.toBe('Slutför raderingen');
    expect(toast.show.mock.calls[0][0]).toContain('Slutför raderingen');
  });
});
