'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsCard } from './SettingsCard';

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
      // `requires-recent-login` kastas av Firebase när sessionen är äldre
      // än ~5 min — GDPR tycker det är OK att kräva re-auth för destructive
      // actions.
      const msg = err instanceof Error && err.message.includes('requires-recent-login')
        ? 'Du måste logga in igen innan du kan ta bort ditt konto.'
        : 'Kunde inte ta bort kontot. Kontrollera anslutningen och försök igen.';
      toast(msg);
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <SettingsCard title="Ta bort konto" tone="danger">
      <p className="text-xs text-text-muted mb-2">
        All data raderas permanent — watchlist, betyg, avsnittsprogress och inställningar.
      </p>
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="px-3 py-[3px] border border-red-300 rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-red-600 hover:bg-red-50"
        >
          Ta bort mitt konto
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-[3px] border-none rounded-sm text-xs font-[inherit] cursor-pointer bg-red-600 text-white disabled:opacity-50"
          >
            {deleting ? 'Raderar…' : 'Ja, ta bort permanent'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="px-3 py-[3px] border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-text-secondary"
          >
            Avbryt
          </button>
        </div>
      )}
    </SettingsCard>
  );
}
