'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsSection } from './SettingsSection';

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

      console.error('[data-export]', err);
      toast('Kunde inte skapa exporten. Försök igen.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <SettingsSection title="Exportera min data">
      <p className="text-xs text-ink-3 mb-2">
        Ladda ner all data om dig som en JSON-fil (GDPR artikel 20). Innehåller profil,
        bibliotek, betyg, progress, recensioner, listor och sociala kopplingar.
      </p>
      <button
        onClick={handleExport}
        disabled={exporting || !uid}
        className="btn btn-ghost btn-sm disabled:opacity-50"
      >
        <Download size={11} />
        {exporting ? 'Förbereder…' : 'Ladda ner mina data'}
      </button>
    </SettingsSection>
  );
}
