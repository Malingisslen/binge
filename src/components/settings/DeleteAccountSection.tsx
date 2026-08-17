'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { classifyDeletionFailure, deletionWasHandedOff } from '@/lib/authErrors';
import { useToast } from '@/contexts/ToastContext';
import { SettingsSection } from './SettingsSection';

export function DeleteAccountSection() {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { deleteAccount } = useAuth();
  const { show: toast } = useToast();

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (err: unknown) {
      // Två fall som ser likadana ut och betyder motsatta saker — se lib/authErrors.
      // Vår egen förkontroll (BIN-748) kastar INNAN något raderats, så där är
      // löftet sant. Utan preflight-koden vore samma mening en lögn.
      //
      // BIN-905, 2026-08-17: den meningen sa tidigare att den otaggade varianten
      // "bara kan nå hit EFTER kaskaden". Slutsatsen står, mekanismen var fel.
      // Sedan BIN-813 kastar färskhetsporten i AuthContext (rad 1190-1194) ett
      // OTAGGAT requires-recent-login när markören står — alltså FÖRE den här
      // omgångens kaskad, och före try-blocket som stämplar hand-over-taggen.
      // Löftet vore ändå falskt, men av en annan anledning: står markören har en
      // TIDIGARE kaskad redan kört.
      //
      // Testet "förkontrollen på ett ANDRA försök" pinnar den kombinationen. Det
      // pinnar KLASSIFICERINGENS beteende, inte en användarväg: står markören
      // sätter AuthContext rad 536 flaggan redan vid profilladdning, så AppShell
      // visar limbo-skärmen och den här komponenten monteras aldrig. Testet når
      // läget för att det mockar useAuth utan skal.
      //
      // Den grenen sa tidigare bara "logga in igen" och teg om vad som hann hända
      // (BIN-796). Tystnad läses inte som osäkerhet utan som "inget hände", så en
      // användare kunde logga in igen och möta ett halvtomt bibliotek utan
      // förvarning. Formuleringen är Malins val 2026-08-07: säg att raderingen
      // påbörjats, och peka på handlingen som slutför den. Påstå varken att allt
      // eller att inget raderades — ingetdera går att veta här.
      //
      // Knapptrycket måste stå med. Det finns ingen återupptagning: inloggningen
      // gör bara token färsk nog för förkontrollen, resten kräver att användaren
      // kör raderingen igen. Utan den meningen gör någon precis vad det står och
      // blir kvar med ett tomt men existerande konto, i tron att det är klart
      // (#19 Customer Support-kritiken, 2026-08-07).
      //
      // BIN-876 la till ett tredje fall. Klumparna i `applyDeletionPlan` är
      // atomära var för sig men inte tillsammans, så ett nätverksfel mitt i
      // kaskaden raderar en del av kontot och lämnar resten. Det syntes förut
      // bara som den generiska grenen längst ned — "kontrollera anslutningen och
      // försök igen" — en mening som antyder att ingenting hände. Det gjorde det.
      // `CASCADE_PARTIAL` är kaskadens egen märkning av det läget; Firebases
      // felkoder kan inte skilja ut det, för ett vanligt nätverksfel bär ingen.
      //
      // Klassificeringen bor i authErrors: limbo-skärmen grenar på exakt samma
      // koder i exakt samma ordning, och ordningen är bärande (förkontrollen bär
      // MED FLIT även `requires-recent-login`). Två kopior av den regeln driver
      // isär den dagen en fjärde kod dyker upp.
      const message = err instanceof Error ? err.message : '';
      const kind = classifyDeletionFailure(message);
      const msg = kind === 'preflight'
        ? 'Du måste logga in igen innan du kan ta bort ditt konto. Ingenting har raderats.'
        : kind === 'recent-login'
          ? 'Raderingen har påbörjats men inte slutförts. Logga in igen och tryck på Slutför raderingen för att avsluta den.'
          : kind === 'partial'
            ? 'Raderingen avbröts av ett anslutningsfel innan den hann bli klar. En del av din data kan redan vara borttagen. Tryck på Slutför raderingen — resten går igenom utan att skada det som redan tagits bort.'
            : 'Kunde inte ta bort kontot. Ingenting har raderats. Kontrollera anslutningen och försök igen.';
      setDeleting(false);
      setConfirming(false);
      // En toast utan åtgärd självdör efter 2,5 s; med åtgärd lever den 6 s
      // (ToastContext). Knappen följer med precis när DEN HÄR komponenten
      // fortfarande finns kvar att trycka i — dvs när felet saknar
      // hand-over-taggen.
      //
      // BIN-796:s skäl för att alltid bifoga en åtgärd gäller inte längre, och
      // det är värt att säga rakt ut så ingen "återställer" knappen: den vilade
      // på att den här toasten var appens ENDA besked om att biblioteket är
      // borta medan kontot finns kvar. Sedan BIN-816 är det inte sant. Efter att
      // markören lagts ned byter `AppShell` ut hela appen mot limbo-skärmen, som
      // berättar samma sak kvarstående i stället för i 2,5 sekunder — och
      // `setConfirming(true)` vore en no-op på en avmonterad komponent, ett
      // löfte om en knapp som inte finns (integrationsgranskningen 2026-08-13).
      // Texterna ovan pekar därför på limbo-skärmens "Slutför raderingen".
      if (deletionWasHandedOff(message)) {
        toast(msg);
      } else {
        toast(msg, { label: 'Försök igen', onClick: () => setConfirming(true) });
      }
    }
  };

  return (
    <SettingsSection title="Ta bort konto" tone="danger">
      <p className="text-xs text-ink-3 mb-2">
        All data raderas permanent — bibliotek, betyg, avsnittsprogress och inställningar.
      </p>
      {/*
        BIN-877 — kontaktvägen ligger i sektionen, inte i felmeddelandena.

        Biljetten ber om den "helst även" i meddelandena; de fyra texterna är
        låsta och juridiskt godkända (BIN-813 villkor 4) och pinnade ordagrant i
        DeleteAccountSection.test.tsx, så att skriva in adressen i dem är att
        skriva om dem — precis det acceptansen förbjuder.

        Raden står OVILLKORLIGT, utanför {!confirming}-ternären nedan, och det är
        hela poängen: den finns både i utgångsläget och medan bekräftelsesteget
        är uppe, alltså också i sekunden användaren är som mest osäker. Till
        skillnad från notisen självdör den inte efter 2,5 sekunder (WCAG 2.2.1,
        #2 Tillgänglighet i BIN-813:s första panel). Testet "kontaktvägen står
        kvar i BÅDA lägena" driver båda och dör på en {!confirming && …}-mutant.

        BIN-905 — vad den här kommentaren INTE längre påstår, och varför:

        Den sa tidigare att raden syns samtidigt som VARJE toast, med skälet att
        felgrenen sätter `confirming` till false. Bägge halvorna var fel.

        Räckvidden avgörs av HAND-OVER-TAGGEN, inte av klassificeringen — samma
        skiljelinje som `deletionWasHandedOff` nedan, och att härleda den ur
        `kind` i stället är att svara på samma fråga på två sätt. Ett fel som
        bär taggen kastades efter att markören lagts ned; då har AppShell bytt
        ut hela appen mot DeletionLimbo och den här komponenten är avmonterad.
        Det gäller taggad `recent-login`, `partial` OCH en taggad GENERISK gren:
        ett avbrott i snapshot-läsningarna, planbygget eller första klumpen ger
        samma generiska text men taggas ändå (se lib/authErrors DELETION_HANDED_
        OFF, och fixturen `${DELETION_HANDED_OFF}: auth/network-request-failed` i
        testfilen). Bara otaggade fel lämnar sektionen monterad.

        Flaggan sätts inte på ett ställe utan på tre — AuthContext rad 536 (vid
        profilladdning, om markören står), rad 638 (storage-lyssnaren mellan
        flikar) och rad 1227 (i catch-blocket, efter rad 1220). AppShell rad
        42-44 räknar upp alla tre.

        Följden är värd att skriva ut, för den är inte uppenbar: kombinationen
        "otaggad recent-login med sektionen monterad" nås i praktiken inte från
        inställningssidan. Står markören redan vid profilladdning renderas
        limbo-skärmen och den här komponenten monteras aldrig. Den kombinationen
        finns som fixtur för att låsa klassificeringens beteende, inte för att
        beskriva en användarväg (integrationsgranskningen 2026-08-17).

        Ingen blir utan adress: DeletionLimbo bär en egen, lika ovillkorlig, i
        sitt <p> på rad 114-118 — inte i notisen, som aldrig bär någon adress
        alls. Den raden är dessutom mer framträdande än den här (text-sm/ink-2
        mot text-xs/ink-3) och pinnad ordagrant i DeletionLimbo.test.tsx:56-67
        (#19 Kundsupports blinda kritik, 2026-08-17).

        Skälet: `setConfirming(false)` är inte det som får raden att överleva
        notisen. Elementet ligger utanför ternären och hade renderats oavsett.
      */}
      <p className="text-xs text-ink-3 mb-2">
        Fastnar raderingen? Mejla{' '}
        <a href="mailto:hej@binge.nu" className="text-acc-deep">hej@binge.nu</a>
        {' '}så hjälper vi dig.
      </p>
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="btn btn-danger-ghost btn-sm"
        >
          Ta bort mitt konto
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="btn btn-danger btn-sm disabled:opacity-50"
          >
            {deleting ? 'Raderar…' : 'Ja, ta bort permanent'}
          </button>
          <button onClick={() => setConfirming(false)} className="btn btn-ghost btn-sm">
            Avbryt
          </button>
        </div>
      )}
    </SettingsSection>
  );
}
