// src/components/groups/HandOverGroupDialog.test.tsx
//
// BIN-1118. Dialogen är där ägaren ser underlaget för sitt val, och där serverns
// vägran når en läsare — båda halvorna pinnas här.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HandOverGroupDialog } from './HandOverGroupDialog';
import type { GroupMember } from '@/types';

const handOverGroup = vi.hoisted(() => vi.fn());
vi.mock('@/lib/firebase/groupHandover', () => ({ handOverGroup }));
const captureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sentry', () => ({ captureError }));

const member = (uid: string, name: string, joinedAt: Date, joinedAtKnown = true): GroupMember => ({
  uid,
  displayName: name,
  username: null,
  photoURL: null,
  providers: [],
  joinedAt,
  joinedAtKnown,
});

const JONAS = member('jonas', 'Jonas', new Date('2024-03-04'));
const SARA = member('sara', 'Sara', new Date('2025-11-02'));

function renderDialog(candidates: GroupMember[], onDone = vi.fn(), onCancel = vi.fn()) {
  render(
    <HandOverGroupDialog
      groupId="g1"
      groupName="Fredagsmys"
      candidates={candidates}
      onDone={onDone}
      onCancel={onCancel}
    />,
  );
  return { onDone, onCancel };
}

function backdropClick(el: HTMLElement) {
  fireEvent.mouseDown(el);
  fireEvent.click(el);
}

describe('HandOverGroupDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('förväljer den första kandidaten och namnger den i knappen', () => {
    renderDialog([JONAS, SARA]);
    expect(screen.getByText('Lämna över till Jonas')).toBeTruthy();
  });

  it('skickar det uid ägaren faktiskt valde, inte det förvalda', () => {
    renderDialog([JONAS, SARA]);
    fireEvent.click(screen.getByDisplayValue('sara'));
    fireEvent.click(screen.getByText('Lämna över till Sara'));
    expect(handOverGroup).toHaveBeenCalledWith('g1', 'sara');
  });

  it('stänger sig först när servern svarat', async () => {
    const { onDone } = renderDialog([JONAS]);
    handOverGroup.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // En lyckad navigering rapporterar ingenting (BIN-1264).
    expect(captureError).not.toHaveBeenCalled();
  });

  /** Ett avvisande av den sort servern formulerar for en lasare. */
  const refusal = (message: string) => {
    const err = new Error(message) as Error & { code: string };
    err.code = 'functions/failed-precondition';
    return err;
  };

  // Serverns vägran är skriven för en läsare, och servern vet VILKEN förutsättning
  // som brast. Dialogen ska visa den, inte hitta på en egen.
  it('visar serverns egen vägran ordagrant och stänger inte', async () => {
    const { onDone } = renderDialog([JONAS]);
    handOverGroup.mockRejectedValueOnce(refusal('Gruppen bytte ägare medan du höll på.'));
    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await screen.findByText('Gruppen bytte ägare medan du höll på.');
    expect(onDone).not.toHaveBeenCalled();
    // En väntad vägran rapporteras inte (BIN-1272).
    expect(captureError).not.toHaveBeenCalled();
  });

  // Motsatsen, och skälet till att genomsläppet är villkorat. Ett nätfel, ett
  // avvisat App Check eller en funktion som inte är driftsatt kastar ett
  // `FirebaseError` vars `message` är teknisk engelska — och eftersom det ÄR ett
  // `Error` hade ett enkelt `err.message` visat just den strängen för den som
  // står och väntar.
  it('visar INTE ett tekniskt fel ordagrant', async () => {
    renderDialog([JONAS]);
    const network = new Error('internal') as Error & { code: string };
    network.code = 'functions/unavailable';
    handOverGroup.mockRejectedValueOnce(network);

    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await screen.findByText(/Överlämningen gick inte igenom/);
    expect(screen.queryByText('internal')).toBeNull();
  });

  // Den kod servern numera skickar för allt som inte är en vägran. Det här är
  // fallet som faktiskt uppstår: en batch-skrivning som faller mitt i.
  it('ett internt serverfel visas inte ordagrant', async () => {
    renderDialog([JONAS]);
    const internal = new Error('5 NOT_FOUND: no entity to update') as Error & { code: string };
    internal.code = 'functions/internal';
    handOverGroup.mockRejectedValueOnce(internal);

    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await screen.findByText(/Överlämningen gick inte igenom/);
    expect(screen.queryByText(/NOT_FOUND/)).toBeNull();
    // Ett fel som inte är en vägran når Sentry (BIN-1272).
    expect(captureError).toHaveBeenCalledWith(internal, {
      scope: 'groups',
      kind: 'handOverGroup-write',
    });
  });

  it('ett fel utan kod visas inte heller ordagrant', async () => {
    renderDialog([JONAS]);
    handOverGroup.mockRejectedValueOnce(new Error('TypeError: x is not a function'));
    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await screen.findByText(/Överlämningen gick inte igenom/);
    expect(screen.queryByText(/is not a function/)).toBeNull();
  });

  it('går att försöka igen efter en vägran', async () => {
    renderDialog([JONAS]);
    handOverGroup.mockRejectedValueOnce(refusal('nej'));
    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await screen.findByText('nej');
    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    expect(handOverGroup).toHaveBeenCalledTimes(2);
  });

  // Den avgörande raden i underlaget. `toDate` svarar NU för en medlemsrad utan
  // användbar tidsstämpel, så utan den här grenen hade just den raden lästs som
  // den NYASTE medlemmen — motsatsen till hur servern rankar samma rad när den
  // väljer efterträdare själv.
  it('säger att medlemstiden är okänd i stället för att visa dagens datum', () => {
    const unstamped = member('okand', 'Okänd', new Date(), false);
    renderDialog([unstamped]);
    expect(screen.getByText('medlemstid okänd')).toBeTruthy();
  });

  it('visar månad och år för en medlem med tidsstämpel', () => {
    renderDialog([JONAS]);
    expect(screen.getByText(/medlem sedan mars 2024/)).toBeTruthy();
  });

  it('varnar om att valet inte går att ångra och att alla får veta', () => {
    renderDialog([JONAS]);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('slutar vara ägare');
    expect(dialog.textContent).toContain('radera gruppen');
    expect(dialog.textContent).toContain('Alla medlemmar får se');
  });

  // Bakgrundsklicket är avbrytandets andra väg, och den var ogrindad medan
  // tangentbordsvägen spärrades. Dialogen ligger som barn till inställnings-
  // modalens egen bakgrund, som stänger på klick — utan spärren stängde ett
  // bakgrundsklick BÅDA, och mitt i ett anrop som får ta 300 sekunder landar
  // svaret i ett avmonterat träd.
  // BIN-1261: bakgrunden är dragsäker (DialogShell), så ett klick räknas bara när
  // även mousedown landade på den. Båda fallen driver därför hela klicket.
  it('ett bakgrundsklick avbryter när inget anrop pågår', () => {
    const { onCancel } = renderDialog([JONAS]);
    backdropClick(screen.getByRole('presentation'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('ett bakgrundsklick avbryter INTE medan anropet ligger ute', async () => {
    const { onCancel } = renderDialog([JONAS]);
    // Ett anrop som aldrig svarar: dialogen står kvar i sitt arbetande läge.
    handOverGroup.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await screen.findByText('Lämnar över…');

    backdropClick(screen.getByRole('presentation'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('ett drag från dialogen ut till bakgrunden avbryter inte', () => {
    const { onCancel } = renderDialog([JONAS]);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('presentation'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('fokus flyttas in i dialogen när den öppnas och tillbaka när den stängs', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(
      <HandOverGroupDialog groupId="g1" groupName="Fredagsmys" candidates={[JONAS]} onDone={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('Tab från något bakom dialogen hamnar i dialogen', () => {
    const behind = document.createElement('button');
    document.body.appendChild(behind);
    renderDialog([JONAS]);
    behind.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    behind.remove();
  });

  // Samma skydd som klickhalvan ovan, i den andra hanteraren. Villkoret är
  // ordagrant detsamma och infört i samma ändring, så utan ett eget fixtur-fall
  // kan det tas bort med hela sviten grön — den här kodbasens återkommande form:
  // ett villkor kopierat till två syskon behöver en prövning per syskon.
  it('Escape avbryter när inget anrop pågår', () => {
    const { onCancel } = renderDialog([JONAS]);
    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // Fallet ovan skjuter Escape PA overlayen, alltsa fran ett element inuti dialogen.
  // Det har fallet driver tangenten fran `document`, dar ingen del av dialogen ar
  // inblandad i vagen dit.
  it('Escape avbryter aven nar fokus star utanfor dialogen', () => {
    const { onCancel } = renderDialog([JONAS]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape avbryter INTE medan anropet ligger ute', async () => {
    const { onCancel } = renderDialog([JONAS]);
    handOverGroup.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await screen.findByText('Lämnar över…');

    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('en annan tangent avbryter aldrig', () => {
    const { onCancel } = renderDialog([JONAS]);
    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Enter' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  // Krysset satt kvar ogrindat när de andra vägarna ut spärrades, osynligt för
  // sviten eftersom inget test drev det. Samma villkor, samma skäl — varje väg
  // som når `onCancel` behöver sitt eget par.
  it('krysset stänger när inget anrop pågår', () => {
    const { onCancel } = renderDialog([JONAS]);
    fireEvent.click(screen.getByLabelText('Stäng överlämning'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('krysset stänger INTE medan anropet ligger ute', async () => {
    const { onCancel } = renderDialog([JONAS]);
    handOverGroup.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await screen.findByText('Lämnar över…');

    fireEvent.click(screen.getByLabelText('Stäng överlämning'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('ett bakgrundsklick når inte förbi dialogen till det som ligger under', () => {
    const outer = vi.fn();
    render(
      <div onClick={outer} role="presentation">
        <HandOverGroupDialog
          groupId="g1"
          groupName="Fredagsmys"
          candidates={[JONAS]}
          onDone={vi.fn()}
          onCancel={vi.fn()}
        />
      </div>,
    );
    backdropClick(screen.getAllByRole('presentation')[1]);
    expect(outer).not.toHaveBeenCalled();
  });

  // Skälet till att `onDone()` ligger UTANFÖR skrivningens `try`. Låg det kvar
  // inuti fångade överlämningens `catch` ett kast från navigeringen och visade
  // "Överlämningen gick inte igenom" — över ett ägarbyte som redan gått igenom.
  // Ett omförsök hade då svarat att ägaren inte äger gruppen, och hen står redan
  // utanför medlemslistan. Samma fall som utträdesdialogens.
  it('ett kast från navigeringen rapporteras inte som en misslyckad överlämning', async () => {
    const onDone = vi.fn(() => { throw new Error('navigeringen sprack'); });
    renderDialog([JONAS], onDone);
    handOverGroup.mockResolvedValueOnce(undefined);

    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    expect(screen.queryByText(/gick inte igenom/)).toBeNull();
    expect(handOverGroup).toHaveBeenCalledTimes(1);
    // BIN-1264: kastet når Sentry under ett EGET kind, skilt från en misslyckad
    // överlämning.
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      scope: 'groups',
      kind: 'handOverGroup-navigation',
    });

    // Och dialogen får inte stå kvar låst. Varje väg ut är spärrad på `working`,
    // så ett `working` som aldrig går tillbaka gör skyddet till en fälla: ingen
    // knapp, ingen tangent och inget bakgrundsklick hade nått ut, och
    // överlämningen hade redan gått igenom.
    await waitFor(() => expect(screen.getByText(/Lämna över till Jonas/)).toBeTruthy());
    expect(screen.queryByText('Lämnar över…')).toBeNull();
    expect(screen.getByText('Avbryt').closest('button')).not.toBeDisabled();
    expect(screen.getByLabelText('Stäng överlämning')).not.toBeDisabled();
  });

  // Fönstret mellan att skrivningen gått igenom och att sidan faktiskt bytts.
  // Dialogen står kvar monterad hela tiden, och utan en terminal spärr blev
  // knappen klickbar igen så fort `working` släpptes. Ett andra anrop svarar då
  // "Du äger inte den här gruppen" — över ett ägarbyte som redan lyckats.
  it('skicka-knappen blir inte klickbar igen medan navigeringen pågår', async () => {
    const onDone = vi.fn();
    renderDialog([JONAS], onDone);
    handOverGroup.mockResolvedValueOnce(undefined);

    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const submitBtn = screen.getByText(/Lämna över till Jonas/).closest('button');
    expect(submitBtn).toBeDisabled();

    fireEvent.click(submitBtn!);
    expect(handOverGroup).toHaveBeenCalledTimes(1);

    // Och avbrytvägarna följer `working`, inte den terminala spärren — dialogen
    // ska fortfarande gå att stänga om navigeringen faller.
    expect(screen.getByText('Avbryt').closest('button')).not.toBeDisabled();
    expect(screen.getByLabelText('Stäng överlämning')).not.toBeDisabled();
  });

  it('avbryt skriver ingenting', () => {
    const { onCancel } = renderDialog([JONAS]);
    fireEvent.click(screen.getByText('Avbryt'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(handOverGroup).not.toHaveBeenCalled();
  });

  // Den väg som saknade sin upptaget-halva längst. Varje väg ut bär samma
  // villkor av samma skäl, så varje väg behöver samma par — den här bunten föll
  // gång på gång på att ett villkor prövades bara där jag råkat tänka på det.
  // `disabled={working}` här går att ta bort med sviten grön utan det fallet.
  it('avbryt avbryter INTE medan anropet ligger ute', async () => {
    const { onCancel } = renderDialog([JONAS]);
    handOverGroup.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByText('Lämna över till Jonas'));
    await screen.findByText('Lämnar över…');

    fireEvent.click(screen.getByText('Avbryt'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
