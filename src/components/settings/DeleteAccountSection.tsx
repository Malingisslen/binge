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
      // löftet sant. Firebases eget requires-recent-login kan bara nå hit EFTER
      // kaskaden, och då vore samma mening en lögn.
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
        skriva om dem — precis det acceptansen förbjuder. Den här raden syns
        dessutom SAMTIDIGT som varje toast: felgrenen sätter `confirming` till
        false, så sektionen står kvar i sitt utgångsläge bakom notisen, och till
        skillnad från notisen självdör den inte efter 2,5 sekunder (WCAG 2.2.1,
        #2 Tillgänglighet i BIN-813:s första panel).
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
