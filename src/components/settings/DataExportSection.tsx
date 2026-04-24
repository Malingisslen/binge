'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsCard } from './SettingsCard';

export function DataExportSection() {
  const { uid } = useAuth();
  const { show: toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!uid) return;
    setExporting(true);
    try {
      // Dynamisk import — håller Firestore query-surface borta från
      // settings-bundle:n tills användaren faktiskt klickar.
      const { buildUserExport, downloadExport } = await import('@/lib/firebase/dataExport');
      const data = await buildUserExport(uid);
      downloadExport(data);
      toast('Dataexport nedladdad.');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[data-export]', err);
      toast('Kunde inte skapa exporten. Försök igen.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <SettingsCard title="Exportera min data">
      <p className="text-xs text-text-muted mb-2">
        Ladda ner all data vi har om dig som en JSON-fil (GDPR artikel 20). Innehåller profil,
        watchlist, betyg, progress, recensioner, listor och sociala kopplingar.
      </p>
      <button
        onClick={handleExport}
        disabled={exporting || !uid}
        className="inline-flex items-center gap-1 px-3 py-[5px] border border-border-main rounded-sm text-xs bg-white cursor-pointer hover:bg-surface-hover disabled:opacity-50"
      >
        <Download size={11} />
        {exporting ? 'Förbereder...' : 'Ladda ner mina data'}
      </button>
    </SettingsCard>
  );
}
