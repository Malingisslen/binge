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
      const message = err instanceof Error ? err.message : '';
      const msg = message.includes(STALE_SESSION_PREFLIGHT)
        ? 'Du måste logga in igen innan du kan ta bort ditt konto. Ingenting har raderats.'
        : message.includes(REQUIRES_RECENT_LOGIN)
          ? 'Du måste logga in igen innan du kan ta bort ditt konto.'
          : 'Kunde inte ta bort kontot. Kontrollera anslutningen och försök igen.';
      toast(msg);
      setDeleting(false);
      setConfirming(false);
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
