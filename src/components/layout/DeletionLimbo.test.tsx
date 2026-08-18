import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DeletionLimbo } from './DeletionLimbo';
import { CASCADE_PARTIAL, REQUIRES_RECENT_LOGIN, STALE_SESSION_PREFLIGHT } from '@/lib/authErrors';

// BIN-816 / ADR 0019 condition 4 + 5, and Malin's answer of 2026-08-13.
//
// Two properties matter here and neither is cosmetic:
//   · The screen offers a way to FINISH the deletion, not merely a description
//     of the state. Condition 5 is explicit that a returning, re-authenticated
//     session should attempt the removal again rather than only suppressing the
//     resurrection forever.
//   · Signing out stays reachable. The marker is uid-scoped, so someone else's
//     account on the same device is unaffected — but only if there is a way to
//     get to it. A limbo screen with one button would trap a shared device.

const auth = vi.hoisted(() => ({
  deleteAccount: vi.fn<() => Promise<void>>(async () => {}),
  signOut: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth.deleteAccount.mockReset();
  auth.deleteAccount.mockResolvedValue(undefined);
  auth.signOut.mockReset();
  auth.signOut.mockResolvedValue(undefined);
});

describe('DeletionLimbo', () => {
  it('säger vad läget är utan att påstå att kontot är borta', () => {
    render(<DeletionLimbo />);

    expect(screen.getByText('Din radering är påbörjad men inte klar')).toBeTruthy();
    // Den får inte lova att allt är raderat (det vet den inte) och inte heller
    // att ingenting är det (det är den ena lögnen BIN-876 handlar om).
    const body = document.body.textContent ?? '';
    expect(body).toContain('kontot finns kvar');
    expect(body).not.toContain('Ingenting har raderats');
  });

  it('lovar inte automatisk uppstädning utan villkor', () => {
    // Sopningen letar efter konton UTAN profil-dokument, så den rör aldrig ett
    // konto vars kaskad föll på första klumpen — och det är just det läget som
    // också visar den här skärmen, med all data i behåll. Ett obetingat "vi
    // städar bort det" sa till den som minst sannolikt sopas att hen kan gå
    // därifrån. Samma feltyp som BIN-876, inne i skärmen som skulle laga den.
    render(<DeletionLimbo />);

    const body = document.body.textContent ?? '';
    expect(body).toContain('Har vi redan hunnit ta bort din profil');
    expect(body).toContain('annars är det den här knappen');
  });

  it('erbjuder en väg till en människa — utan att röra den låsta texten (BIN-877)', () => {
    render(<DeletionLimbo />);

    const mail = screen.getByText('hej@binge.nu') as HTMLAnchorElement;
    expect(mail.getAttribute('href')).toBe('mailto:hej@binge.nu');
    // Tillagd, inte inskriven: den juridiskt godkända ingressen står ordagrant
    // kvar. Utan det här påståendet kan en "förbättring" av kontaktraden äta
    // upp meningen som är hela skärmens poäng.
    expect(document.body.textContent).toContain(
      'En del av din data kan redan vara borttagen, men själva kontot finns kvar.',
    );
  });

  it('säger att raderingen slutförs härifrån — utan att lova en ångra-knapp (BIN-911)', () => {
    render(<DeletionLimbo />);

    // Sjudygnslöftet är sant på DEN HÄR enheten och blev efter ADR 0022 fel för
    // gott för den som återkommer på en annan. Den låsta texten får inte skrivas
    // om, så raden är ett TILLÄGG som pekar tillbaka hit.
    expect(document.body.textContent).toContain('Raderingen slutförs härifrån.');
    expect(document.body.textContent).toContain('kom tillbaka hit och tryck på knappen');

    // #19 Kundsupport: raden får ALDRIG glida över i ett löfte om att ångra.
    // Det finns ingen självbetjäningsväg tillbaka — den som vill behålla kontot
    // hamnar i ett supportmedierat fall-till-fall-beslut (RUNBOOK §5f) som ofta
    // inte kan rädda något. Ett verb som "ångra" skickar folk dit i onödan.
    expect(document.body.textContent).not.toContain('ångra');
    expect(document.body.textContent).not.toContain('avbryt');

    // Och den låsta meningen står ordagrant kvar bredvid tillägget — samma
    // skydd som kontaktraden ovan har, av samma skäl.
    expect(document.body.textContent).toContain(
      'städas kontot bort automatiskt inom sju dygn',
    );
  });

  it('slutför raderingen — inte bara tystar återskapandet', async () => {
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    // ADR 0019 villkor 5: en återvändande markerad session ska FÖRSÖKA igen.
    // Utan det här anropet är skärmen bara en spärr som ingen kan ta sig ur.
    expect(auth.deleteAccount).toHaveBeenCalledTimes(1);
    // Och knappen släpps. `deleteAccount` returnerar TYST utan att kasta när
    // `auth.currentUser` är null (en återkallad token mellan render och klick) —
    // det läser som framgång här, och utan det här påståendet blev skärmen
    // sittande på "Slutför…" för alltid med enda vägen ut en omladdning
    // (integrationsgranskningen 2026-08-13).
    expect(screen.getByText('Slutför raderingen')).toBeTruthy();
    expect(screen.queryByText('Slutför…')).toBeNull();
  });

  it('går att logga ut ifrån — annars fastnar en delad enhet', async () => {
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Logga ut')); });

    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('en för gammal session pekar på ny inloggning, inte på ett tekniskt fel', async () => {
    auth.deleteAccount.mockRejectedValue(
      new Error(`${REQUIRES_RECENT_LOGIN} (${STALE_SESSION_PREFLIGHT}): sessionen är för gammal`),
    );
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Logga ut, logga in igen');
    // Knappen måste bli användbar igen — annars är enda vägen ut en omladdning.
    expect(screen.getByText('Slutför raderingen')).toBeTruthy();
  });

  it('Firebases eget recent-login-fel hamnar i samma gren', async () => {
    // På DEN HÄR skärmen betyder de två koderna samma sak och har samma botemedel.
    // Till skillnad från inställningssidan finns här ingen "ingenting raderades"-
    // försäkran att få rätt: något ÄR redan borta.
    auth.deleteAccount.mockRejectedValue(new Error(`Firebase: Error (${REQUIRES_RECENT_LOGIN}).`));
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    expect(screen.getByRole('alert').textContent).toContain('Logga ut, logga in igen');
  });

  it('försök 1 föll i kaskaden, försök 2 möter en gammal session — och skärmen ber om ny inloggning, inte om ett tekniskt fel (BIN-813)', async () => {
    // Kriterium 4 på BIN-813: sekvensen försök-1-sedan-försök-2 ska finnas HÄR.
    //
    // Vad det här testet bevisar, och vad det inte gör. Filen mockar `useAuth`
    // helt (rad 17-22), så `deleteAccount` är en `vi.fn` — förkontrollens val av
    // felkod kan omöjligt prövas härifrån. Att låtsas annat vore ett test som
    // mäter sin egen mock. Den halvan bevisas i `AuthContext.test.tsx` med tre
    // påståenden, kontrollprovet för en OMARKERAD gammal session inräknat.
    //
    // Det HÄR är limbo-skärmens halva: att den nya strängen — `requires-recent-
    // login` UTAN `STALE_SESSION_PREFLIGHT` — når rätt gren.
    //
    // Vad det tillför, exakt, för att ingen ska tro mer om det än det är: det är
    // sekvensen — två klick på samma monterade skärm, felet klassificerat om
    // mellan dem — som kriteriet ber om, och som den tomma raden det ersätter
    // aldrig var.
    //
    // Två saker det INTE är, båda mätta i stället för antagna:
    //   · Det är inte det enda som fångar en klassificerare som börjar kräva
    //     preflight-koden. Den mutanten fäller Firebase-testet nedanför också,
    //     eftersom dess format saknar koden av samma skäl (2 röda, inte 1).
    //   · Strängen nedan är HANDKOPIERAD från AuthContext.tsx, inte kopplad till
    //     den. Skrivs meddelandet om där och inte här förblir det här testet
    //     grönt — verifierat av testgranskaren 2026-08-15 genom att byta ut
    //     produktionstexten och köra: 10/10 gröna. En tidigare version av den
    //     här kommentaren påstod motsatsen. Vill man ha den kopplingen på
    //     riktigt måste meddelandet exporteras som en konstant och importeras
    //     på båda ställena; det är inte gjort, så lita inte på synken.
    auth.deleteAccount.mockRejectedValueOnce(new Error(`${CASCADE_PARTIAL}: offline`));
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });
    expect(screen.getByRole('alert').textContent).toContain('kom en bit till');
    // Knappen måste ha släppts, annars finns inget andra försök att göra.
    expect(screen.queryByText('Slutför…')).toBeNull();

    // Handkopierat från det AuthContext.tsx kastar när markören är nere (BIN-813,
    // beslut (a)). Ändras det där måste den här raden ändras med — av en människa;
    // ingenting tvingar fram det. Se noten överst.
    auth.deleteAccount.mockRejectedValueOnce(
      new Error(`${REQUIRES_RECENT_LOGIN}: sessionen är för gammal för att slutföra raderingen`),
    );

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    expect(auth.deleteAccount).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert').textContent).toContain('Logga ut, logga in igen');
    expect(screen.queryByText('Slutför…')).toBeNull();
  });

  it('ett avbrott mitt i uppstädningen ber om ett nytt försök', async () => {
    auth.deleteAccount.mockRejectedValue(new Error(`${CASCADE_PARTIAL}: offline`));
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    expect(screen.getByRole('alert').textContent).toContain('kom en bit till');
  });

  it('ett okänt fel ger ett neutralt besked och låser inte knappen', async () => {
    auth.deleteAccount.mockRejectedValue(new Error('auth/network-request-failed'));
    render(<DeletionLimbo />);

    await act(async () => { fireEvent.click(screen.getByText('Slutför raderingen')); });

    expect(screen.getByRole('alert').textContent).toContain('Kontrollera anslutningen');
    expect(screen.queryByText('Slutför…')).toBeNull();
  });
});
