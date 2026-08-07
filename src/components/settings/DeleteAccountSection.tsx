'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { REQUIRES_RECENT_LOGIN, STALE_SESSION_PREFLIGHT } from '@/lib/authErrors';
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
      const message = err instanceof Error ? err.message : '';
      const startedNotFinished = !message.includes(STALE_SESSION_PREFLIGHT)
        && message.includes(REQUIRES_RECENT_LOGIN);
      const msg = message.includes(STALE_SESSION_PREFLIGHT)
        ? 'Du måste logga in igen innan du kan ta bort ditt konto. Ingenting har raderats.'
        : startedNotFinished
          ? 'Raderingen har påbörjats men inte slutförts. Logga in igen och tryck på Ta bort mitt konto en gång till för att slutföra den.'
          : 'Kunde inte ta bort kontot. Kontrollera anslutningen och försök igen.';
      setDeleting(false);
      setConfirming(false);
      // En toast utan åtgärd självdör efter 2,5 s; med åtgärd lever den 6 s
      // (ToastContext). Den här grenen är appens ENDA besked om att biblioteket
      // redan är borta medan kontot finns kvar, och meddelandet är dubbelt så
      // långt som det utan åtgärd — 2,5 s räcker inte för att läsa det. Åtgärden
      // ger både lästiden och en knapp att trycka på, i stället för en instruktion
      // som hinner försvinna (integrationsgranskningen, 2026-08-07).
      if (startedNotFinished) {
        toast(msg, { label: 'Försök igen', onClick: () => setConfirming(true) });
      } else {
        toast(msg);
      }
    }
  };

  return (
    <SettingsSection title="Ta bort konto" tone="danger">
      <p className="text-xs text-ink-3 mb-2">
        All data raderas permanent — bibliotek, betyg, avsnittsprogress och inställningar.
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
